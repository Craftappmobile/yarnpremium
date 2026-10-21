// Server-only: product photos sent through a private Telegram channel.
//
// The shop posts an album (or one photo) to the channel with the SKU in its
// caption; the first photo is the main one, at most 6 are kept. The caption
// names a colour or spools of it:
//   «MO374»              every spool of the colour: MO374, MO374-1, MO374-2…,
//                        and the spools KeyCRM gets later (the shop takes
//                        stock spool by spool, each with its own SKU)
//   «MO362-1, MO362-2»   these spools only (commas, spaces or lines between)
//   «+MO374»             the new photos go before the spools' own (the new
//                        main photo: photos are retaken to sell better), else
//                        they replace them
//
// The bot, an administrator of the channel, gets every post (channel_post), and
// for each album:
//   1. uploads the largest size of each photo to KeyCRM's storage once
//      (POST /storage/upload): KeyCRM doesn't copy photos given by link, and
//      Telegram's file links carry the bot's token;
//   2. finds the spools in the catalog snapshot (and a spool it lacks in KeyCRM
//      itself), attaches the photos there — all of them to a product with one
//      offer, the main one to an offer of a product with several, since the
//      product's photos are shared by all its offers — and makes them the
//      spools' gallery on the site (lib/catalog.ts, catalog:photos);
//   3. remembers them for the colour (tg:photo:colors), for 90 days: after
//      every catalog sync (`applyColorPhotos`) a spool KeyCRM got since gets
//      them too, and the bot says so in the channel. A spool named but not in
//      KeyCRM yet waits the same way;
//   4. answers in the channel: 👌 and ✅ (in the site and KeyCRM), 👀 and ⏳
//      (nothing in KeyCRM yet), 👎 and ❌ (what went wrong). Editing the
//      caption sends the album again.
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
//   tg:photo:colors        hash  album group -> ColorPhotos JSON (90 days)
//   tg:photo:pending       hash  albums from before tg:photo:colors, handled again once
//   tg:photo:file          hash  Telegram file_unique_id -> KeyCRM file URL
//   tg:photo:log           list  the last 50 albums handled, newest first

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import {
  MAX_PHOTOS,
  type PhotoTarget,
  readPhotoTargets,
  readProductPhotos,
  readProducts,
  saveProductPhotos,
} from "@/lib/catalog"
import { KeycrmError, keycrmBackground, keycrmGet, keycrmGetPages, keycrmSend, keycrmUpload } from "@/lib/keycrm"
import { LOOKALIKES } from "@/lib/product-videos"
import { redis } from "@/lib/redis"
import { staffCode } from "@/lib/telegram-staff"
import { esc, tg } from "@/lib/telegram"

const KEY_CHANNEL = "tg:photo:channel"
const KEY_COLORS = "tg:photo:colors"
const KEY_PENDING = "tg:photo:pending"
const KEY_FILES = "tg:photo:file"
const KEY_LOG = "tg:photo:log"
const albumKey = (group: string) => `tg:album:${group}`
const ALBUM_TTL = 7 * 24 * 3600
/** How long a colour's photos are given to spools KeyCRM gets later. */
const COLOR_DAYS = 90
/** Telegram sends an album's photos one by one; it counts as complete after this long without a new one. */
const SETTLE_MS = 6000
/** Of the cron run (app/api/cron/telegram): no more spools are started after this. */
const BUDGET_MS = 120_000
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
  /** The caption's SKUs, as written. */
  sku: string
  photos: number
  ok: boolean
  /** Nothing in KeyCRM yet: given after a later catalog sync. */
  waiting?: boolean
  /** What happened: where the photos went, or what went wrong. */
  note: string
}

export interface PhotoChannel {
  chatId: number
  title: string
  at: string
}

/** A SKU of the caption: a colour (every spool of it) or one spool. */
interface Wanted {
  /** As written: «MO374», «MO362-1». */
  label: string
  /** spoolKey of it. */
  key: string
  /** No spool number: the colour and all its spools. */
  colour: boolean
}

/** An album's photos, uploaded to KeyCRM, and the spools that have them. */
export interface ColorPhotos {
  group: string
  chatId: number
  /** The captioned photo, which the bot's answers reply to. */
  messageId: number
  /** The bot's answer, edited when a waiting album gets its first spool. */
  replyId?: number
  caption: string
  wanted: Wanted[]
  urls: string[]
  adding: boolean
  at: string
  /** SKUs (as KeyCRM spells them) given these photos. */
  applied: string[]
}

/** Spool numbers count: «MO 374 - 1» and «mo374-1» are one SKU, «MO374-1» and «MO3741» two. */
export function spoolKey(sku: string): string {
  return sku
    .toLowerCase()
    .replace(/[авеікмнорстух]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/[–—_]/g, "-")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
}

/** The colour a spool belongs to: «mo374» for «mo374-2» and for «mo374» itself. */
const colourOf = (key: string) => key.replace(/-\d+$/, "")

/** «+MO374», «MO362-1, MO362-2», «mo 362 - 1»: the SKUs a caption names, and whether it adds. */
export function parseCaption(caption: string): { adding: boolean; wanted: Wanted[] } {
  const adding = /^\s*\+/.test(caption)
  const text = caption.replace(/\+/g, " ").replace(/\s*[-–—]\s*(?=\d)/g, "-")
  const wanted = new Map<string, Wanted>()
  for (const raw of text.split(/[\s,;]+/)) {
    const label = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    if (!/\p{L}/u.test(label) || !/\d/.test(label)) continue
    const key = spoolKey(label)
    if (!wanted.has(key)) wanted.set(key, { label, key, colour: colourOf(key) === key })
  }
  return { adding, wanted: [...wanted.values()] }
}

/** Whether a SKU (as KeyCRM spells it) is one the caption names. */
function names(w: Wanted, sku: string): boolean {
  const key = spoolKey(sku)
  return w.colour ? colourOf(key) === w.key : key === w.key
}

export async function readPhotoChannel(): Promise<PhotoChannel | null> {
  const raw = await (await redis()).get(KEY_CHANNEL)
  return raw ? JSON.parse(raw) : null
}

/** Albums no spool in KeyCRM has yet. */
export async function readWaitingColors(): Promise<ColorPhotos[]> {
  const all = Object.values(await (await redis()).hGetAll(KEY_COLORS)).map((json) => JSON.parse(json) as ColorPhotos)
  return all.filter((c) => c.applied.length === 0)
}

export async function readPhotoLog(): Promise<PhotoLogEntry[]> {
  return (await (await redis()).lRange(KEY_LOG, 0, 49)).map((json) => JSON.parse(json))
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
      "Альбом до 6 фото, у підписі — артикул. Перше фото — головне.",
      "MO374 — фото на всі бобіни кольору (MO374-1, MO374-2…), і на ті, що з'являться в KeyCRM пізніше.",
      "MO362-1, MO362-2 — лише на ці бобіни.",
      "+MO374 — додати нові фото першими до наявних, без + — замінити.",
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

const log = async (entry: PhotoLogEntry) =>
  (await redis()).multi().lPush(KEY_LOG, JSON.stringify(entry)).lTrim(KEY_LOG, 0, 49).exec()

/** Uploads an album, gives it to the spools KeyCRM has, remembers it for the rest, and answers. */
async function handleAlbum(chatId: number, group: string, replyId?: number): Promise<void> {
  const r = await redis()
  const photos = await albumPhotos(group)
  if (photos.length === 0) return
  const captioned = photos.find((p) => p.caption) ?? photos[0]
  const { adding, wanted } = parseCaption(captioned.caption)
  // An edited caption: the same album, its earlier answer.
  const before = await r.hGet(KEY_COLORS, group).then((j) => (j ? (JSON.parse(j) as ColorPhotos) : null))
  const color: ColorPhotos = {
    group,
    chatId,
    messageId: captioned.messageId,
    replyId: replyId ?? before?.replyId,
    caption: wanted.map((w) => w.label).join(", "),
    wanted,
    urls: [],
    adding,
    at: new Date().toISOString(),
    applied: [],
  }
  let result: Applied
  try {
    if (wanted.length === 0) {
      throw new Error(
        "У підписі немає артикула. Додайте його підписом до альбому, наприклад: MO374 (або MO362-1, MO362-2, або +MO374, щоб додати фото до наявних)",
      )
    }
    result = (
      await keycrmBackground(async () => {
        const kept = photos.slice(0, MAX_PHOTOS)
        for (const [i, photo] of kept.entries()) color.urls.push(await upload(photo, `${wanted[0].label}-${i + 1}`))
        const targets = await targetsFor(wanted, true)
        return apply(color, targets)
      })
    ).result
  } catch (e) {
    // KeyCRM's answer says what it didn't accept.
    const note = e instanceof KeycrmError ? `${e.message} ${e.body.slice(0, 300)}` : (e as Error).message
    const entry: PhotoLogEntry = { at: new Date().toISOString(), sku: color.caption, photos: photos.length, ok: false, note }
    await log(entry)
    await answer(chatId, captioned.messageId, entry, color.replyId)
    return
  }
  const entry = report(color, result, photos.length)
  color.replyId = await answer(chatId, captioned.messageId, entry, color.replyId)
  await r.hSet(KEY_COLORS, group, JSON.stringify(color))
  await r.hDel(KEY_PENDING, group)
  await log(entry)
}

interface Applied {
  /** SKUs given the photos now. */
  skus: string[]
  /** Photos of the old ones dropped to stay within 6 («+»). */
  dropped: number
  /** Spools named one by one that KeyCRM doesn't have yet. */
  missing: string[]
  /** A colour whose spools have different colour names in KeyCRM: given to none of them. */
  mixed: string[]
}

/**
 * The spools the caption names. A spool named one by one that the snapshot
 * lacks is looked up in KeyCRM (`ask`: not right after a sync, when the
 * snapshot is as fresh as KeyCRM).
 */
async function targetsFor(wanted: Wanted[], ask: boolean): Promise<PhotoTarget[]> {
  const all = await readPhotoTargets()
  const found = new Map<string, PhotoTarget>()
  for (const w of wanted) {
    const mine = all.filter((t) => names(w, t.sku))
    if (mine.length === 0 && !w.colour && ask) {
      const t = await askKeycrm(w.label)
      if (t) mine.push(t)
    }
    for (const t of mine) found.set(t.sku, t)
  }
  return [...found.values()]
}

/** Gives the album's photos to these spools in KeyCRM and on the site. */
async function apply(color: ColorPhotos, targets: PhotoTarget[]): Promise<Applied> {
  const result: Applied = { skus: [], dropped: 0, missing: [], mixed: [] }
  // «MO374» means one colour: spools whose colour names differ in KeyCRM are not guessed at.
  const products = new Map((await readProducts(targets.map((t) => t.sku))).map((p) => [p.sku, p]))
  const ok: PhotoTarget[] = []
  for (const w of color.wanted) {
    const mine = targets.filter((t) => names(w, t.sku) && !ok.includes(t))
    const colours = new Set(mine.map((t) => products.get(t.sku)?.color?.trim().toLowerCase()).filter(Boolean))
    if (w.colour && colours.size > 1) result.mixed.push(w.label)
    else ok.push(...mine)
    if (!w.colour && mine.length === 0) result.missing.push(w.label)
  }
  for (const target of ok) {
    if (color.applied.includes(target.sku)) continue
    // Adding: the new photos first, then the spool's own.
    const old = color.adding ? (await readProductPhotos(target.sku)).filter((u) => !color.urls.includes(u)) : []
    const urls = [...color.urls, ...old].slice(0, MAX_PHOTOS)
    result.dropped = Math.max(result.dropped, color.urls.length + old.length - urls.length)
    await attach(target, urls).catch(async (e) => {
      // KeyCRM may not take back photos stored elsewhere than its upload storage: the new ones, then (the site has all).
      if (!(e instanceof KeycrmError) || old.length === 0) throw e
      console.error("[telegram-photos] attach with old photos:", e.message)
      await attach(target, color.urls)
    })
    if (await saveProductPhotos(target.sku, urls)) {
      try {
        revalidatePath(`/product/${encodeURIComponent(target.sku)}`)
      } catch {
        // Outside a request: the page catches up within the hour.
      }
    }
    color.applied.push(target.sku)
    result.skus.push(target.sku)
  }
  if (result.skus.length) {
    try {
      revalidatePath("/")
      revalidatePath("/kategoriya/[slug]", "page")
    } catch {}
  }
  return result
}

function report(color: ColorPhotos, result: Applied, posted: number): PhotoLogEntry {
  const lines: string[] = []
  if (result.skus.length) {
    lines.push(`${color.urls.length} фото → ${result.skus.join(", ")}`)
    if (color.adding) {
      lines.push(`нові фото першими${result.dropped ? `, ${result.dropped} старих прибрано з кінця (більше ${MAX_PHOTOS} не можна)` : ""}`)
    }
  }
  if (result.missing.length) lines.push(`ще немає в KeyCRM: ${result.missing.join(", ")} — додам фото, щойно з'являться`)
  for (const label of result.mixed) {
    lines.push(`${label}: у KeyCRM бобіни різних кольорів — вкажіть артикули бобін через кому, наприклад ${label}-1, ${label}-2`)
  }
  const colours = color.wanted.filter((w) => w.colour && !result.mixed.includes(w.label)).map((w) => w.label)
  if (colours.length && !result.skus.length && !result.mixed.length) {
    lines.push(`${colours.join(", ")}: ще немає в KeyCRM — фото збережені, підуть самі, щойно з'явиться бобіна`)
  } else if (colours.length) {
    lines.push(`нові бобіни ${colours.join(", ")} отримають ці фото самі`)
  }
  if (posted > MAX_PHOTOS) lines.push(`взято перші ${MAX_PHOTOS} з ${posted}`)
  const waiting = result.skus.length === 0 && result.mixed.length === 0
  return {
    at: new Date().toISOString(),
    sku: color.caption,
    photos: color.urls.length,
    ok: result.skus.length > 0 && result.mixed.length === 0,
    waiting,
    note: lines.join("\n"),
  }
}

/**
 * Run after each catalog sync (app/api/cron/telegram): spools KeyCRM got since
 * are given their colour's photos (the newest album naming them), and
 * albums from before colours were remembered are handled once more.
 */
export async function applyColorPhotos(deadline = Date.now() + BUDGET_MS): Promise<{ given: number; waiting: number; old?: number }> {
  const r = await redis()
  const old = Object.entries(await r.hGetAll(KEY_PENDING))
  for (const [group, json] of old) {
    // Each one uploads its photos: what doesn't fit goes with the next run, the daily post comes first.
    if (Date.now() > deadline) return { given: 0, waiting: 0, old: (await r.hLen(KEY_PENDING)) }
    const p = JSON.parse(json) as { chatId: number; replyId?: number }
    await handleAlbum(p.chatId, group, p.replyId).catch((e) => console.error("[telegram-photos] old album", group, (e as Error).message))
    await r.hDel(KEY_PENDING, group)
  }

  const cutoff = Date.now() - COLOR_DAYS * 86400_000
  const colors: ColorPhotos[] = []
  for (const [group, json] of Object.entries(await r.hGetAll(KEY_COLORS))) {
    const c = JSON.parse(json) as ColorPhotos
    if (Date.parse(c.at) < cutoff) await r.hDel(KEY_COLORS, group)
    else colors.push(c)
  }
  if (colors.length === 0) return { given: 0, waiting: 0 }
  // Newest first: a spool gets the latest album naming it, never an older one after it.
  colors.sort((a, b) => b.at.localeCompare(a.at))
  const targets = await readPhotoTargets()
  const byAlbum = new Map<ColorPhotos, PhotoTarget[]>()
  for (const t of targets) {
    const c = colors.find((c) => c.wanted.some((w) => names(w, t.sku)))
    if (c && !c.applied.includes(t.sku)) byAlbum.set(c, [...(byAlbum.get(c) ?? []), t])
  }
  let given = 0
  for (const [c, mine] of byAlbum) {
    if (Date.now() > deadline) break
    try {
      const hadAny = c.applied.length > 0
      const { result } = await keycrmBackground(() => apply(c, mine))
      if (result.skus.length === 0) continue
      given += result.skus.length
      const entry = report(c, result, c.urls.length)
      if (!hadAny) {
        // It was waiting: its ⏳ answer becomes ✅.
        c.replyId = await answer(c.chatId, c.messageId, entry, c.replyId)
      } else {
        await answer(c.chatId, c.messageId, { ...entry, note: `нова бобіна: ${result.skus.join(", ")} — фото кольору ${c.caption}` })
      }
      await r.hSet(KEY_COLORS, c.group, JSON.stringify(c))
      await log(entry)
    } catch (e) {
      console.error("[telegram-photos] colour", c.caption, (e as Error).message)
    }
  }
  return { given, waiting: colors.filter((c) => c.applied.length === 0).length }
}

/**
 * A spool the catalog snapshot doesn't have yet (the product was created after
 * the last sync): KeyCRM itself, so a new product needn't wait for the sync.
 */
async function askKeycrm(sku: string): Promise<PhotoTarget | null> {
  try {
    return await findOffer(sku)
  } catch (e) {
    // No answer from KeyCRM: the spool waits for the next sync as if it were new.
    console.error("[telegram-photos] KeyCRM lookup", sku, (e as Error).message)
    return null
  }
}

/** A SKU's offer in KeyCRM itself (spaces and case don't matter); null when KeyCRM has none. Throws when KeyCRM fails. */
export async function findOffer(sku: string): Promise<PhotoTarget | null> {
  const res = await keycrmGet<{ data?: any[] }>("/offers", { "filter[sku]": sku, include: "product", limit: 50 })
  const wanted = spoolKey(sku)
  const offer = (res.data ?? []).find((o) => spoolKey(String(o.sku ?? "")) === wanted && !o.is_archived && !o.product?.is_archived)
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

/** Puts the photos on the KeyCRM product, or the main one on the offer when the product has other offers. */
async function attach(target: PhotoTarget, urls: string[]): Promise<void> {
  if (target.offers <= 1) await keycrmSend("PUT", `/products/${target.productId}`, { pictures: urls })
  await keycrmSend("PUT", "/offers", { offers: [{ id: target.offerId, image_url: urls[0] }] })
}

/** Reacts to the album and replies (or edits the earlier reply). Returns the reply's id. */
async function answer(chatId: number, messageId: number, entry: PhotoLogEntry, replyId?: number): Promise<number | undefined> {
  await tg("setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji: entry.ok ? "👌" : entry.waiting ? "👀" : "👎" }],
  }).catch(() => {})
  const mark = entry.ok ? "✅" : entry.waiting ? "⏳" : "❌"
  const text = `${mark} <b>${esc(entry.sku || "без артикула")}</b>\n${esc(entry.note)}`
  if (replyId) {
    const edited = await tg("editMessageText", { chat_id: chatId, message_id: replyId, text, parse_mode: "HTML" })
      .then(() => true)
      .catch((e) => /not modified/i.test(String(e?.description ?? e?.message)))
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
