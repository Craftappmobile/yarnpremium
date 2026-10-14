// Server-only: product photos sent through a private Telegram channel.
//
// The shop posts an album (or one photo) to the channel with the SKU as its
// caption, e.g. «ST98»; the first photo is the main one, at most 6 are kept.
// The bot, an administrator of the channel, gets every post (channel_post), and
// for each album:
//   1. downloads the largest size of each photo and uploads it to KeyCRM's
//      storage (POST /storage/upload): KeyCRM doesn't copy photos given by
//      link, and Telegram's file links carry the bot's token;
//   2. attaches them in KeyCRM. A product with one offer gets them all as its
//      photos (PUT /products/{id}, pictures); a colour of a product with
//      several offers can hold one photo only, the main one (PUT /offers,
//      image_url), since the product's photos are shared by all its colours;
//   3. makes them the SKU's gallery on the site at once (lib/catalog.ts,
//      catalog:photos), and answers in the channel: 👌 and a reply, or 👎 and
//      what went wrong. Editing the caption sends the album again.
//
// Settings: TELEGRAM_PHOTO_CHANNEL, the channel's id (-100…) or @username. The
// admin page lists the channels the bot was made an administrator of, with
// their ids.
//
// Redis keys:
//   tg:album:<group>       hash  message id -> photo of the album (7 days)
//   tg:album:<group>:at    ms timestamp of the album's last photo
//   tg:album:<group>:done  set once the album is handled (cleared by an edit)
//   tg:photo:file          hash  Telegram file_unique_id -> KeyCRM file URL
//   tg:photo:channels      hash  chat id -> title of channels the bot administers
//   tg:photo:log           list  the last 50 albums handled, newest first

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { MAX_PHOTOS, type PhotoTarget, photoTarget, saveProductPhotos } from "@/lib/catalog"
import { KeycrmError, keycrmBackground, keycrmSend, keycrmUpload } from "@/lib/keycrm"
import { redis } from "@/lib/redis"
import { esc, tg } from "@/lib/telegram"

const KEY_FILES = "tg:photo:file"
const KEY_CHANNELS = "tg:photo:channels"
const KEY_LOG = "tg:photo:log"
const albumKey = (group: string) => `tg:album:${group}`
const ALBUM_TTL = 7 * 24 * 3600
/** Telegram sends an album's photos one by one; it counts as complete after this long without a new one. */
const SETTLE_MS = 6000
/** KeyCRM's limit for one file. */
const MAX_FILE_BYTES = 10 * 1024 * 1024

interface AlbumPhoto {
  messageId: number
  fileId: string
  uniqueId: string
  caption: string
}

export interface PhotoLogEntry {
  at: string
  sku: string
  photos: number
  ok: boolean
  /** What happened: where the photos went, or what went wrong. */
  note: string
}

export function photoChannel(): string {
  return process.env.TELEGRAM_PHOTO_CHANNEL?.trim() ?? ""
}

function isPhotoChannel(chat: any): boolean {
  const channel = photoChannel()
  if (!channel || chat?.type !== "channel") return false
  return channel === String(chat.id) || (chat.username && channel.toLowerCase() === `@${chat.username}`.toLowerCase())
}

/** The largest size of a photo, or an image sent as a file (uncompressed). */
function photoOf(post: any): { fileId: string; uniqueId: string } | null {
  const sizes: any[] = post.photo ?? []
  const largest = sizes.reduce((a, b) => (a && a.width * a.height >= b.width * b.height ? a : b), null)
  if (largest) return { fileId: largest.file_id, uniqueId: largest.file_unique_id }
  const doc = post.document
  if (doc && String(doc.mime_type ?? "").startsWith("image/")) return { fileId: doc.file_id, uniqueId: doc.file_unique_id }
  return null
}

/** Remembers channels the bot became an administrator of, so the admin page can show their ids. */
export async function noteChannelMember(member: any): Promise<void> {
  if (member?.chat?.type !== "channel") return
  const r = await redis()
  const id = String(member.chat.id)
  if (member.new_chat_member?.status === "administrator") {
    await r.hSet(KEY_CHANNELS, id, String(member.chat.title ?? member.chat.username ?? id))
  } else await r.hDel(KEY_CHANNELS, id)
}

export async function readPhotoChannels(): Promise<{ id: string; title: string }[]> {
  const all = await (await redis()).hGetAll(KEY_CHANNELS)
  return Object.entries(all).map(([id, title]) => ({ id, title }))
}

export async function readPhotoLog(): Promise<PhotoLogEntry[]> {
  return (await (await redis()).lRange(KEY_LOG, 0, 49)).map((json) => JSON.parse(json))
}

/**
 * A post (or an edited post) of a channel. Returns false for any channel but
 * the photo channel; posts without a photo are ignored.
 */
export async function handleChannelPost(post: any, edited: boolean): Promise<boolean> {
  if (!isPhotoChannel(post?.chat)) return false
  const photo = photoOf(post)
  if (!photo) return true
  const group = post.media_group_id ? String(post.media_group_id) : `m${post.message_id}`
  const item: AlbumPhoto = { messageId: post.message_id, ...photo, caption: String(post.caption ?? "").trim() }
  const r = await redis()
  await r
    .multi()
    .hSet(albumKey(group), String(post.message_id), JSON.stringify(item))
    .expire(albumKey(group), ALBUM_TTL)
    .set(`${albumKey(group)}:at`, String(Date.now()), { EX: ALBUM_TTL })
    .exec()
  if (edited) await r.del(`${albumKey(group)}:done`)
  // Answer Telegram now; the album is handled once its last photo is in.
  after(() => settle(post.chat.id, group).catch((e) => console.error("[telegram-photos]", group, (e as Error).message)))
  return true
}

async function settle(chatId: number, group: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const r = await redis()
  // A photo that came later handles the album after its own wait.
  if (Date.now() - Number(await r.get(`${albumKey(group)}:at`)) < SETTLE_MS - 500) return
  if (!(await r.set(`${albumKey(group)}:done`, "1", { NX: true, EX: ALBUM_TTL }))) return

  const photos = Object.values(await r.hGetAll(albumKey(group)))
    .map((json) => JSON.parse(json) as AlbumPhoto)
    .sort((a, b) => a.messageId - b.messageId)
  if (photos.length === 0) return
  const captioned = photos.find((p) => p.caption) ?? photos[0]
  const sku = captioned.caption.split(/\s+/)[0] ?? ""

  let entry: PhotoLogEntry
  try {
    entry = await saveAlbum(sku, photos)
  } catch (e) {
    // KeyCRM's answer says what it didn't accept.
    const note = e instanceof KeycrmError ? `${e.message} ${e.body.slice(0, 300)}` : (e as Error).message
    entry = { at: new Date().toISOString(), sku, photos: photos.length, ok: false, note }
  }
  await r.multi().lPush(KEY_LOG, JSON.stringify(entry)).lTrim(KEY_LOG, 0, 49).exec()
  await answer(chatId, captioned.messageId, entry)
}

async function saveAlbum(sku: string, photos: AlbumPhoto[]): Promise<PhotoLogEntry> {
  if (!sku) throw new Error("У підписі немає артикула. Додайте його підписом до альбому, наприклад: ST98")
  const target = await photoTarget(sku)
  if (!target) {
    throw new Error(
      `Артикула ${sku} немає в KeyCRM (серед неархівних варіантів). Якщо товар щойно створений, він з'явиться після синхронізації каталогу (до 30 хвилин) — тоді змініть підпис, і фото відправляться знову.`,
    )
  }
  const kept = photos.slice(0, MAX_PHOTOS)
  const { result: urls } = await keycrmBackground(async () => {
    const uploaded: string[] = []
    for (const [i, photo] of kept.entries()) uploaded.push(await upload(photo, `${target.sku}-${i + 1}`))
    await attach(target, uploaded)
    return uploaded
  })

  const onSite = await saveProductPhotos(target.sku, urls)
  if (onSite) {
    try {
      revalidatePath("/")
      revalidatePath("/kategoriya/[slug]", "page")
      revalidatePath(`/product/${target.sku}`)
    } catch (e) {
      // The pages catch up within the hour then (their revalidate time).
      console.error("[telegram-photos] revalidate:", (e as Error).message)
    }
  }

  const notes = [
    target.offers > 1
      ? `KeyCRM: головне фото — у варіант (у товарі ${target.offers} кольорів, а варіант тримає одне фото)`
      : "KeyCRM: фото товару",
    onSite ? "сайт: оновлено" : "сайт: цього артикула на сайті немає (категорія не продається або товар без артикула)",
  ]
  if (photos.length > MAX_PHOTOS) notes.push(`взято перші ${MAX_PHOTOS} з ${photos.length}`)
  return { at: new Date().toISOString(), sku: target.sku, photos: urls.length, ok: true, note: notes.join("; ") }
}

/** Uploads one photo to KeyCRM's storage once; the same Telegram file is never uploaded twice. */
async function upload(photo: AlbumPhoto, name: string): Promise<string> {
  const r = await redis()
  const known = await r.hGet(KEY_FILES, photo.uniqueId)
  if (known) return known
  const file = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: photo.fileId }).catch(() => {
    // Bots can't download files over 20 MB.
    throw new Error("Telegram не віддає це фото (файли понад 20 МБ боту недоступні). Надішліть його звичайним фото.")
  })
  if (!file.file_path) throw new Error("Telegram не віддав файл фото, спробуйте надіслати ще раз.")
  if ((file.file_size ?? 0) > MAX_FILE_BYTES) {
    throw new Error("Фото більше 10 МБ — KeyCRM таких не приймає. Надішліть його звичайним фото, не файлом.")
  }
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Telegram file download: HTTP ${res.status}`)
  const blob = await res.blob()
  if (blob.size > MAX_FILE_BYTES) throw new Error("Фото більше 10 МБ — KeyCRM таких не приймає.")
  const ext = file.file_path.match(/\.(jpe?g|png|webp)$/i)?.[1]?.toLowerCase() ?? "jpg"
  const type = blob.type.startsWith("image/") ? blob.type : `image/${ext === "jpg" ? "jpeg" : ext}`
  const stored = await keycrmUpload(new Blob([blob], { type }), `${name}.${ext}`)
  if (!stored.url) throw new Error("KeyCRM не повернув посилання на завантажений файл")
  await r.hSet(KEY_FILES, photo.uniqueId, stored.url)
  return stored.url
}

/** Puts the photos on the KeyCRM product, or the main one on the offer when the product has other colours. */
async function attach(target: PhotoTarget, urls: string[]): Promise<void> {
  if (target.offers <= 1) await keycrmSend("PUT", `/products/${target.productId}`, { pictures: urls })
  await keycrmSend("PUT", "/offers", { offers: [{ id: target.offerId, image_url: urls[0] }] })
}

async function answer(chatId: number, messageId: number, entry: PhotoLogEntry): Promise<void> {
  await tg("setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji: entry.ok ? "👌" : "👎" }],
  }).catch(() => {})
  const text = entry.ok
    ? `✅ <b>${esc(entry.sku)}</b>: ${entry.photos} фото.\n${esc(entry.note)}`
    : `❌ <b>${esc(entry.sku || "без артикула")}</b>: ${esc(entry.note)}`
  await tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    disable_notification: entry.ok,
  }).catch((e) => console.error("[telegram-photos] reply:", (e as Error).message))
}
