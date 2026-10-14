// Server-only: product photos sent through a private Telegram channel.
//
// The shop posts an album (or one photo) to the channel with the SKU as its
// caption, e.g. «ST98»; the first photo is the main one, at most 6 are kept.
// The bot, an administrator of the channel, gets every post (channel_post), and
// for each album:
//   1. finds the SKU in KeyCRM: in the catalog snapshot, else by asking KeyCRM.
//      A SKU KeyCRM doesn't have yet (the photos are taken during the day, the
//      products are imported in the evening) waits: the bot answers ⏳ and
//      tries again after every catalog sync (lib/catalog.ts, every 30 minutes)
//      for as long as the album is kept, 7 days;
//   2. downloads the largest size of each photo and uploads it to KeyCRM's
//      storage (POST /storage/upload): KeyCRM doesn't copy photos given by
//      link, and Telegram's file links carry the bot's token;
//   3. attaches them in KeyCRM. A product with one offer gets them all as its
//      photos (PUT /products/{id}, pictures); a colour of a product with
//      several offers can hold one photo only, the main one (PUT /offers,
//      image_url), since the product's photos are shared by all its colours;
//   4. makes them the SKU's gallery on the site at once (lib/catalog.ts,
//      catalog:photos), and answers in the channel: 👌 and a reply, or 👎 and
//      what went wrong. Editing the caption sends the album again.
//
// The channel is the one where an administrator posted «/photos_here <code>»
// (the code of lib/telegram-staff.ts, shown on /admin/telegram);
// «/photos_off <code>» stops it.
//
// Redis keys:
//   tg:photo:channel       JSON  { chatId, title, at }
//   tg:album:<group>       hash  message id -> photo of the album (7 days)
//   tg:album:<group>:at    ms timestamp of the album's last photo
//   tg:album:<group>:done  set once the album is handled (cleared by an edit)
//   tg:photo:pending       hash  album group -> PendingAlbum JSON: SKU not in KeyCRM yet
//   tg:photo:file          hash  Telegram file_unique_id -> KeyCRM file URL
//   tg:photo:log           list  the last 50 albums handled, newest first

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { MAX_PHOTOS, type PhotoTarget, photoTarget, saveProductPhotos } from "@/lib/catalog"
import { KeycrmError, keycrmBackground, keycrmGet, keycrmGetPages, keycrmSend, keycrmUpload } from "@/lib/keycrm"
import { redis } from "@/lib/redis"
import { staffCode } from "@/lib/telegram-staff"
import { esc, tg } from "@/lib/telegram"

const KEY_CHANNEL = "tg:photo:channel"
const KEY_FILES = "tg:photo:file"
const KEY_PENDING = "tg:photo:pending"
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
  /** Not in KeyCRM yet: tried again after each catalog sync. */
  waiting?: boolean
  /** What happened: where the photos went, or what went wrong. */
  note: string
}

export interface PhotoChannel {
  chatId: number
  title: string
  at: string
}

/** A SKU KeyCRM didn't have when the album came: retried after each catalog sync. */
interface PendingAlbum {
  chatId: number
  group: string
  sku: string
  /** The captioned photo, which the bot's answers reply to. */
  messageId: number
  /** The bot's ⏳ answer, edited once the photos are in. */
  replyId?: number
  since: string
}

export async function readPhotoChannel(): Promise<PhotoChannel | null> {
  const raw = await (await redis()).get(KEY_CHANNEL)
  return raw ? JSON.parse(raw) : null
}

export async function readPendingAlbums(): Promise<PendingAlbum[]> {
  return Object.values(await (await redis()).hGetAll(KEY_PENDING)).map((json) => JSON.parse(json))
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

export async function readPhotoLog(): Promise<PhotoLogEntry[]> {
  return (await (await redis()).lRange(KEY_LOG, 0, 49)).map((json) => JSON.parse(json))
}

/** «/photos_here <code>» or «/photos_off <code>» posted in a channel. True when the post was one. */
async function channelCommand(post: any): Promise<boolean> {
  const m = String(post.text ?? "").trim().match(/^\/(photos_here|photos_off)(?:@\w+)?(?:\s+(\S+))?/)
  if (!m) return false
  const chatId: number = post.chat.id
  const say = (text: string) => tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" }).catch(() => {})
  if (m[2] !== staffCode()) {
    await say("Потрібен код зі сторінки статистики Telegram на сайті: /photos_here КОД")
    return true
  }
  const r = await redis()
  // The command itself isn't for the channel's readers.
  await tg("deleteMessage", { chat_id: chatId, message_id: post.message_id }).catch(() => {})
  if (m[1] === "photos_off") {
    await r.del(KEY_CHANNEL)
    await say("Фото з цього каналу більше не потрапляють на сайт і в KeyCRM. Те, що вже там, залишається.")
    return true
  }
  const channel: PhotoChannel = { chatId, title: String(post.chat.title ?? chatId), at: new Date().toISOString() }
  await r.set(KEY_CHANNEL, JSON.stringify(channel))
  await say(
    [
      "✅ Фото з цього каналу тепер потрапляють на сайт і в KeyCRM.",
      "",
      "Альбом до 6 фото, у підписі — артикул, наприклад ST98. Перше фото — головне.",
      "Артикула ще немає в KeyCRM — я відповім ⏳ і сам додам фото, щойно товар з'явиться.",
    ].join("\n"),
  )
  return true
}

/**
 * A post (or an edited post) of a channel. Returns false for any channel but
 * the photo channel; posts without a photo are ignored.
 */
export async function handleChannelPost(post: any, edited: boolean): Promise<boolean> {
  if (post?.chat?.type !== "channel") return false
  if (!edited && (await channelCommand(post))) return true
  const channel = await readPhotoChannel()
  if (!channel || channel.chatId !== post.chat.id) return false
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
  await handleAlbum(chatId, group)
}

/** The album's photos, in the order they were posted. */
async function albumPhotos(group: string): Promise<AlbumPhoto[]> {
  return Object.values(await (await redis()).hGetAll(albumKey(group)))
    .map((json) => JSON.parse(json) as AlbumPhoto)
    .sort((a, b) => a.messageId - b.messageId)
}

/** Sends an album on, or leaves it waiting for its SKU, and answers in the channel. */
async function handleAlbum(chatId: number, group: string, pending?: PendingAlbum): Promise<"done" | "waiting" | "gone"> {
  const r = await redis()
  const photos = await albumPhotos(group)
  if (photos.length === 0) {
    // Kept for 7 days: the SKU never came.
    await r.hDel(KEY_PENDING, group)
    if (pending?.replyId) {
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: pending.replyId,
        text: `❌ <b>${esc(pending.sku)}</b>: за 7 днів такого артикула в KeyCRM так і не з'явилося, фото не збережені. Надішліть альбом ще раз, коли товар буде в KeyCRM.`,
        parse_mode: "HTML",
      }).catch(() => {})
    }
    return "gone"
  }
  const captioned = photos.find((p) => p.caption) ?? photos[0]
  const sku = captioned.caption.split(/\s+/)[0] ?? ""

  let entry: PhotoLogEntry
  try {
    // A retry comes right after a catalog sync: the snapshot is as fresh as KeyCRM.
    entry = await saveAlbum(sku, photos, !pending)
  } catch (e) {
    // KeyCRM's answer says what it didn't accept.
    const note = e instanceof KeycrmError ? `${e.message} ${e.body.slice(0, 300)}` : (e as Error).message
    entry = { at: new Date().toISOString(), sku, photos: photos.length, ok: false, note }
  }

  if (entry.waiting) {
    // Already waiting (a retry after a sync): nothing new to say.
    if (pending && pending.sku === sku) return "waiting"
    const replyId = await answer(chatId, captioned.messageId, entry)
    const wait: PendingAlbum = { chatId, group, sku, messageId: captioned.messageId, replyId, since: new Date().toISOString() }
    await r.hSet(KEY_PENDING, group, JSON.stringify(wait))
    await r.multi().lPush(KEY_LOG, JSON.stringify(entry)).lTrim(KEY_LOG, 0, 49).exec()
    return "waiting"
  }
  const waited = pending ?? (await r.hGet(KEY_PENDING, group).then((j) => (j ? (JSON.parse(j) as PendingAlbum) : undefined)))
  await r.hDel(KEY_PENDING, group)
  await r.multi().lPush(KEY_LOG, JSON.stringify(entry)).lTrim(KEY_LOG, 0, 49).exec()
  await answer(chatId, captioned.messageId, entry, waited?.replyId)
  return "done"
}

/**
 * Run after each catalog sync (app/api/cron/telegram): albums whose SKU KeyCRM
 * didn't have go on now if it has it, and are given up with the album itself (7 days).
 */
export async function retryPendingAlbums(): Promise<{ done: number; waiting: number }> {
  const run = { done: 0, waiting: 0 }
  for (const p of await readPendingAlbums()) {
    try {
      const result = await handleAlbum(p.chatId, p.group, p)
      if (result === "done") run.done++
      else if (result === "waiting") run.waiting++
    } catch (e) {
      console.error("[telegram-photos] retry", p.sku, (e as Error).message)
    }
  }
  return run
}

/** SKU not in KeyCRM yet: the album waits for it. */
class NotYet extends Error {}

async function saveAlbum(sku: string, photos: AlbumPhoto[], ask: boolean): Promise<PhotoLogEntry> {
  if (!sku) throw new Error("У підписі немає артикула. Додайте його підписом до альбому, наприклад: ST98")
  const kept = photos.slice(0, MAX_PHOTOS)
  let found: { target: PhotoTarget; urls: string[] }
  try {
    found = (
      await keycrmBackground(async () => {
        const target = (await photoTarget(sku)) ?? (ask ? await askKeycrm(sku) : null)
        if (!target) throw new NotYet()
        const uploaded: string[] = []
        for (const [i, photo] of kept.entries()) uploaded.push(await upload(photo, `${target.sku}-${i + 1}`))
        await attach(target, uploaded)
        return { target, urls: uploaded }
      })
    ).result
  } catch (e) {
    if (!(e instanceof NotYet)) throw e
    return {
      at: new Date().toISOString(),
      sku,
      photos: photos.length,
      ok: false,
      waiting: true,
      note: `Артикула ${sku} ще немає в KeyCRM. Щойно товар там з'явиться, фото самі підуть на сайт і в KeyCRM (перевіряю кожні 30 хвилин, 7 днів). Якщо артикул з помилкою, виправте підпис.`,
    }
  }
  const { target, urls } = found

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
    onSite
      ? "сайт: оновлено"
      : "сайт: фото збережені, з'являться разом із товаром після синхронізації каталогу (або категорія не продається на сайті)",
  ]
  if (photos.length > MAX_PHOTOS) notes.push(`взято перші ${MAX_PHOTOS} з ${photos.length}`)
  return { at: new Date().toISOString(), sku: target.sku, photos: urls.length, ok: true, note: notes.join("; ") }
}

/**
 * A SKU the catalog snapshot doesn't have yet (the product was created after
 * the last sync): KeyCRM itself, so a new product needn't wait for the sync.
 */
async function askKeycrm(sku: string): Promise<PhotoTarget | null> {
  try {
    return await findOffer(sku)
  } catch (e) {
    // No answer from KeyCRM: the album waits for the next sync as if the SKU were new.
    console.error("[telegram-photos] KeyCRM lookup", sku, (e as Error).message)
    return null
  }
}

async function findOffer(sku: string): Promise<PhotoTarget | null> {
  const res = await keycrmGet<{ data?: any[] }>("/offers", { "filter[sku]": sku, include: "product", limit: 50 })
  const wanted = sku.toLowerCase()
  const offer = (res.data ?? []).find(
    (o) => String(o.sku ?? "").trim().toLowerCase() === wanted && !o.is_archived && !o.product?.is_archived,
  )
  if (!offer) return null
  const { items } = await keycrmGetPages("/offers", { "filter[product_id]": offer.product_id, "filter[is_archived]": "false" })
  const offers = items.filter((o: any) => o.product_id === offer.product_id).length || 1
  return { sku: String(offer.sku).trim(), offerId: offer.id, productId: offer.product_id, offers }
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

/** Reacts to the album and replies (or edits the earlier ⏳ reply). Returns the reply's id. */
async function answer(chatId: number, messageId: number, entry: PhotoLogEntry, replyId?: number): Promise<number | undefined> {
  await tg("setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji: entry.ok ? "👌" : entry.waiting ? "👀" : "👎" }],
  }).catch(() => {})
  const text = entry.ok
    ? `✅ <b>${esc(entry.sku)}</b>: ${entry.photos} фото.\n${esc(entry.note)}`
    : `${entry.waiting ? "⏳" : "❌"} <b>${esc(entry.sku || "без артикула")}</b>: ${esc(entry.note)}`
  if (replyId) {
    const edited = await tg("editMessageText", { chat_id: chatId, message_id: replyId, text, parse_mode: "HTML" })
      .then(() => true)
      .catch(() => false)
    if (edited) return replyId
  }
  const sent = await tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    disable_notification: entry.ok,
  }).catch((e) => {
    console.error("[telegram-photos] reply:", (e as Error).message)
    return null
  })
  return sent?.message_id
}
