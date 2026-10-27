// Server-only: product photos sent through a private Telegram channel.
//
// The shop posts an album (or one photo) to the channel with the SKU in its
// caption; the first photo is the main one, at most 6 are kept. The caption
// names a colour or spools of it:
//   «MO374»              every spool of the colour: MO374, MO374-1, MO374-2…,
//                        and the spools KeyCRM gets later (the shop takes
//                        stock spool by spool, each with its own SKU)
//   «MO362-1, MO362-2»   these spools only (commas, spaces or lines between)
//   «10064»              a SKU of digits only (4 or more), likewise
//   «+MO374», «MO374+»   the new photos go after the spools' own, the main
//                        photo stays (samples, say). A spool that would have
//                        more than 6 isn't given them: the answer says so,
//                        with a button «Все одно додати» that drops the
//                        spool's oldest photos but the main one to make room
//   «+MO374 головне»     the new photos go before the spools' own (the new
//                        main photo: photos are retaken to sell better)
//   without «+»          the new photos replace the spools' own
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
//      caption sends the album again, and spools the old caption named and the
//      new one doesn't get back the photos they had before it;
//   5. under ✅, a button «↩️ Скасувати» does the same for all the album's
//      spools (a SKU mistyped, say) and stops it going to spools KeyCRM gets
//      later. Deleting the post doesn't: Telegram doesn't tell bots of it.
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
//   tg:album:<group>:reply the bot's ❌ answer, edited once the caption is corrected
//   tg:album:<group>:undo  set for 2 minutes by «↩️ Скасувати», so a second press doesn't undo it again
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
  restoreProductPhotos,
  saveProductPhotos,
  type ShownPhotos,
} from "@/lib/catalog"
import { KeycrmError, keycrmBackground, keycrmGet, keycrmGetPages, keycrmSend, keycrmUpload } from "@/lib/keycrm"
import { LOOKALIKES } from "@/lib/product-videos"
import { redis } from "@/lib/redis"
import { staffCode } from "@/lib/telegram-staff"
import { esc, type InlineButton, keyboard, tg } from "@/lib/telegram"

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
  /** «↩️ Скасувати»: the spools have their photos back. */
  undone?: boolean
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
  /** Keeps the spools' own photos: the new ones after them with `last`, else first («+MO374 головне»). */
  adding: boolean
  /** «+MO374», «MO374+»: the new photos after the spools' own, the main one unchanged. */
  last?: boolean
  /** «Все одно додати» pressed: room is made by dropping old photos but the main one. */
  force?: boolean
  at: string
  /** SKUs (as KeyCRM spells them) given these photos. */
  applied: string[]
  /** The photos each of them had before, for «↩️ Скасувати». */
  previous?: Record<string, ShownPhotos>
  /** «↩️ Скасувати» pressed: the spools have their photos back, and new ones don't get these. */
  undone?: boolean
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
export const colourOf = (key: string) => key.replace(/-\d+$/, "")

/** «+MO374», «MO374+», «+MO374 головне», «MO362-1, MO362-2», «mo 362 - 1»: the SKUs a caption names, and whether and where it adds. */
export function parseCaption(caption: string): { adding: boolean; last: boolean; wanted: Wanted[] } {
  // A «+» anywhere adds at the end, the main photo kept: that's what the shop means by adding.
  const adding = caption.includes("+")
  const last = adding && !/головн/iu.test(caption)
  const text = caption.replace(/\+/g, " ").replace(/\s*[-–—]\s*(?=\d)/g, "-")
  const wanted = new Map<string, Wanted>()
  for (const raw of text.split(/[\s,;]+/)) {
    const label = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    // Letters and digits (MO374), or digits alone, 4 at least (kid on silk: 10064, 10064-1).
    if (!(/\p{L}/u.test(label) && /\d/.test(label)) && !/^\d{4,}(?:-\d+)?$/.test(label)) continue
    const key = spoolKey(label)
    if (!wanted.has(key)) wanted.set(key, { label, key, colour: colourOf(key) === key })
  }
  return { adding, last, wanted: [...wanted.values()] }
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
  return all.filter((c) => c.applied.length === 0 && !c.undone)
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
      "MO374 (чи 10064) — фото на всі бобіни кольору (MO374-1, MO374-2…), і на ті, що з'являться в KeyCRM пізніше.",
      "MO362-1, MO362-2 — лише на ці бобіни.",
      "+MO374 — додати нові фото в кінець до наявних, головне фото не зміниться.",
      "+MO374 головне — додати нові фото першими, перше з них стане головним.",
      "Без + — нові фото замінять наявні.",
      "Помилились в артикулі — «↩️ Скасувати» під відповіддю бота або виправте підпис: бобіни отримають свої фото назад. Видалення поста їх не повертає.",
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
  const { adding, last, wanted } = parseCaption(captioned.caption)
  // An edited caption: the same album, its earlier answer.
  const before = await r.hGet(KEY_COLORS, group).then((j) => (j ? (JSON.parse(j) as ColorPhotos) : null))
  // Spools it named that the caption no longer does (a SKU mistyped) get back what they had; the rest keep the record of it.
  const earlier = before && !before.undone ? before : null
  const gone = earlier?.applied.filter((sku) => !wanted.some((w) => names(w, sku))) ?? []
  let restored: Restored | null = null
  const color: ColorPhotos = {
    group,
    chatId,
    messageId: captioned.messageId,
    replyId: replyId ?? before?.replyId ?? (Number(await r.get(`${albumKey(group)}:reply`)) || undefined),
    caption: wanted.map((w) => w.label).join(", "),
    wanted,
    urls: [],
    adding,
    ...(last ? { last } : {}),
    at: new Date().toISOString(),
    applied: [],
    previous: Object.fromEntries(Object.entries(earlier?.previous ?? {}).filter(([sku]) => !gone.includes(sku))),
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
        if (earlier && gone.length) restored = await restore(earlier, gone)
        const targets = await targetsFor(wanted, true)
        return apply(color, targets)
      })
    ).result
  } catch (e) {
    // KeyCRM's answer says what it didn't accept.
    const note = e instanceof KeycrmError ? `${e.message} ${e.body.slice(0, 300)}` : (e as Error).message
    const entry: PhotoLogEntry = { at: new Date().toISOString(), sku: color.caption, photos: photos.length, ok: false, note }
    await log(entry)
    // A caption added or corrected later turns this answer into the new one rather than adding another.
    const sent = await answer(chatId, captioned.messageId, entry, color.replyId)
    if (sent) await r.set(`${albumKey(group)}:reply`, String(sent), { EX: ALBUM_TTL })
    return
  }
  const entry = report(color, result, photos.length)
  if (restored) entry.note = [entry.note, "підпис змінено:", ...restoredLines(restored)].filter(Boolean).join("\n")
  color.replyId = await answer(chatId, captioned.messageId, entry, color.replyId, buttons(color, result))
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
  /** Colours whose spools KeyCRM names differently, given the photos all the same: «YK011: «бежевий» — YK011-1…; «сірий» — …». */
  mixed: string[]
  /** «+MO374»: spools that would have more than 6 photos, not given them. */
  full: string[]
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
  const result: Applied = { skus: [], dropped: 0, missing: [], mixed: [], full: [] }
  // «MO374» is one colour: spools KeyCRM names otherwise get the photos too (a colour name mistyped is likelier
  // than one code for two colours), and the answer names them, for «↩️ Скасувати» if they are another colour.
  const products = new Map((await readProducts(targets.map((t) => t.sku))).map((p) => [p.sku, p]))
  const ok: PhotoTarget[] = []
  for (const w of color.wanted) {
    const mine = targets.filter((t) => names(w, t.sku) && !ok.includes(t))
    ok.push(...mine)
    if (!w.colour && mine.length === 0) result.missing.push(w.label)
    const byColour = new Map<string, string[]>()
    for (const t of mine) {
      const name = products.get(t.sku)?.color?.trim().toLowerCase()
      if (name) byColour.set(name, [...(byColour.get(name) ?? []), t.sku])
    }
    if (w.colour && byColour.size > 1) {
      const list = [...byColour].map(([name, skus]) => `«${name}» — ${skus.length > 3 ? `${skus.length} бобін` : skus.join(", ")}`)
      result.mixed.push(`${w.label}: ${list.join("; ")}`)
    }
  }
  for (const target of ok) {
    if (color.applied.includes(target.sku)) continue
    const shown = await readProductPhotos(target.sku)
    // Adding: the new photos after the spool's own; or («+MO374 головне») first, then the spool's own.
    const old = color.adding ? shown.photos.filter((u) => !color.urls.includes(u)) : []
    let urls: string[]
    if (color.last && old.length) {
      const over = old.length + color.urls.length - MAX_PHOTOS
      if (over > 0 && !color.force) {
        result.full.push(target.sku)
        continue
      }
      // Room is made by the oldest photos after the main one: those just after it.
      const kept = over > 0 ? [old[0], ...old.slice(1 + over)] : old
      urls = [...kept, ...color.urls].slice(0, MAX_PHOTOS)
      result.dropped = Math.max(result.dropped, old.length - kept.length)
    } else {
      urls = [...color.urls, ...old].slice(0, MAX_PHOTOS)
      result.dropped = Math.max(result.dropped, color.urls.length + old.length - urls.length)
    }
    // What it had before the album, kept once: an edited caption gives it the album again.
    color.previous = { ...color.previous, [target.sku]: color.previous?.[target.sku] ?? shown }
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

/** What «↩️ Скасувати», or a caption naming other spools, did to the album's spools. */
interface Restored {
  /** Spools given back the photos they had before the album. */
  skus: string[]
  /** Of them, those that had none: KeyCRM keeps the album's (the bot doesn't clear KeyCRM's photos). */
  bare: string[]
  /** Of them, those KeyCRM didn't take the old photos back for. */
  keycrm: string[]
  /** Spools with other photos since (a later album, KeyCRM): left as they are. */
  changed: string[]
  /** Spools given the album before the bot kept what they had: left as they are. */
  unknown: string[]
}

/** Gives these spools of the album back the photos they had before it, in KeyCRM and on the site. */
async function restore(color: ColorPhotos, skus: string[]): Promise<Restored> {
  const out: Restored = { skus: [], bare: [], keycrm: [], changed: [], unknown: [] }
  const targets = await readPhotoTargets()
  for (const sku of skus) {
    const before = color.previous?.[sku]
    if (!before) {
      out.unknown.push(sku)
      continue
    }
    if (!(await readProductPhotos(sku)).photos.some((u) => color.urls.includes(u))) {
      out.changed.push(sku)
      continue
    }
    if (before.photos.length === 0) out.bare.push(sku)
    else {
      const target = targets.find((t) => t.sku === sku) ?? (await askKeycrm(sku))
      const fixed = target
        ? await attach(target, before.photos).then(
            () => true,
            (e) => {
              console.error("[telegram-photos] restore", sku, (e as Error).message)
              return false
            },
          )
        : false
      if (!fixed) out.keycrm.push(sku)
    }
    if (await restoreProductPhotos(sku, before)) {
      try {
        revalidatePath(`/product/${encodeURIComponent(sku)}`)
      } catch {}
    }
    out.skus.push(sku)
  }
  if (out.skus.length) {
    try {
      revalidatePath("/")
      revalidatePath("/kategoriya/[slug]", "page")
    } catch {}
  }
  return out
}

function restoredLines(res: Restored): string[] {
  const lines: string[] = []
  const had = res.skus.filter((sku) => !res.bare.includes(sku))
  if (had.length) lines.push(`${had.join(", ")}: повернуто фото, що були до цього альбому`)
  if (res.bare.length) {
    lines.push(`${res.bare.join(", ")}: до альбому фото не було — у KeyCRM приберіть фото альбому вручну, інакше воно повернеться на сайт`)
  }
  if (res.keycrm.length) {
    lines.push(`${res.keycrm.join(", ")}: KeyCRM не взяв старі фото назад — поверніть їх там вручну, інакше на сайт повернеться фото альбому`)
  }
  if (res.changed.length) lines.push(`${res.changed.join(", ")}: уже мають інші фото — їх не чіпаю`)
  if (res.unknown.length) lines.push(`${res.unknown.join(", ")}: бот не знає, які фото були раніше — поверніть їх вручну`)
  return lines
}

function undoReport(color: ColorPhotos, res: Restored): PhotoLogEntry {
  const colours = color.wanted.filter((w) => w.colour).map((w) => w.label)
  const lines = ["скасовано", ...restoredLines(res)]
  if (colours.length) lines.push(`нові бобіни ${colours.join(", ")} цих фото не отримають`)
  return { at: new Date().toISOString(), sku: color.caption, photos: color.urls.length, ok: false, undone: true, note: lines.join("\n") }
}

function report(color: ColorPhotos, result: Applied, posted: number): PhotoLogEntry {
  const lines: string[] = []
  if (result.skus.length) {
    lines.push(`${color.urls.length} фото → ${result.skus.join(", ")}`)
    if (color.last) {
      lines.push(
        `нові фото в кінці, головне не змінилось${result.dropped ? `; ${result.dropped} найстаріших прибрано (більше ${MAX_PHOTOS} не можна)` : ""}`,
      )
    } else if (color.adding) {
      lines.push(`нові фото першими${result.dropped ? `, ${result.dropped} старих прибрано з кінця (більше ${MAX_PHOTOS} не можна)` : ""}`)
    }
  }
  if (result.full.length) {
    lines.push(
      `${result.full.join(", ")}: вже ${MAX_PHOTOS} фото, нові не додано. «Все одно додати» прибере найстаріші фото, крім головного.`,
    )
  }
  if (result.missing.length) lines.push(`ще немає в KeyCRM: ${result.missing.join(", ")} — додам фото, щойно з'являться`)
  if (result.mixed.length) {
    lines.push(
      `⚠️ у KeyCRM у бобін різні назви кольору — ${result.mixed.join("; ")}. Фото додано всім. Якщо це справді різні кольори, натисніть «↩️ Скасувати» і вкажіть бобіни через кому.`,
    )
  }
  const colours = color.wanted.filter((w) => w.colour).map((w) => w.label)
  if (colours.length && !result.skus.length) {
    lines.push(`${colours.join(", ")}: ще немає в KeyCRM — фото збережені, підуть самі, щойно з'явиться бобіна`)
  } else if (colours.length) {
    lines.push(`нові бобіни ${colours.join(", ")} отримають ці фото самі`)
  }
  if (posted > MAX_PHOTOS) lines.push(`взято перші ${MAX_PHOTOS} з ${posted}`)
  const waiting = result.skus.length === 0 && result.full.length === 0
  return {
    at: new Date().toISOString(),
    sku: color.caption,
    photos: color.urls.length,
    ok: result.skus.length > 0 && result.full.length === 0,
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
    else if (!c.undone) colors.push(c)
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
        c.replyId = await answer(c.chatId, c.messageId, entry, c.replyId, buttons(c, result))
      } else {
        const note = `нова бобіна: ${result.skus.join(", ")} — фото кольору ${c.caption}`
        await answer(c.chatId, c.messageId, { ...entry, note }, undefined, buttons(c, result))
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

const FORCE = "ph:force:"
const UNDO = "ph:undo:"

/** Under an answer: «Все одно додати» when spools had no room for «+MO374», «↩️ Скасувати» once spools have the album. */
function buttons(color: ColorPhotos, result: Applied) {
  const rows: InlineButton[][] = []
  if (result.full.length) rows.push([{ text: "Все одно додати", callback_data: `${FORCE}${color.group}` }])
  // Spools given the album before what they had was kept can't be given it back.
  if (color.applied.some((sku) => color.previous?.[sku])) rows.push([{ text: "↩️ Скасувати", callback_data: `${UNDO}${color.group}` }])
  return rows.length ? keyboard(rows) : undefined
}

/**
 * A button pressed under the bot's answer in the photo channel: «Все одно
 * додати» gives the album to the spools that had no room, dropping their
 * oldest photos but the main one; «↩️ Скасувати» gives its spools back the
 * photos they had before it. True when the press was the photo channel's.
 */
export async function handlePhotoCallback(cq: any): Promise<boolean> {
  const data = String(cq.data ?? "")
  const undo = data.startsWith(UNDO)
  if (!undo && !data.startsWith(FORCE)) return false
  const channel = await readPhotoChannel()
  const r = await redis()
  const group = data.slice((undo ? UNDO : FORCE).length)
  const json = channel && channel.chatId === cq.message?.chat?.id ? await r.hGet(KEY_COLORS, group) : null
  const color = json ? (JSON.parse(json) as ColorPhotos) : null
  // Pressed twice: the first press is the one undoing it.
  const twice = undo && color && !(await r.set(`${albumKey(group)}:undo`, "1", { NX: true, EX: 120 }))
  if (!color || color.undone || twice) {
    const text = color ? "Уже скасовано." : "Цей альбом уже не знайти: надішліть фото ще раз."
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {})
    return true
  }
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: undo ? "Повертаю старі фото…" : "Додаю…" }).catch(() => {})
  if (!undo) color.force = true
  after(async () => {
    try {
      if (undo) {
        const { result } = await keycrmBackground(() => restore(color, color.applied))
        color.undone = true
        const entry = undoReport(color, result)
        color.replyId = await answer(color.chatId, color.messageId, entry, color.replyId ?? cq.message.message_id)
        // Pressed under a «нова бобіна» answer: its button goes too.
        if (cq.message.message_id !== color.replyId) {
          await tg("editMessageReplyMarkup", { chat_id: color.chatId, message_id: cq.message.message_id }).catch(() => {})
        }
        await r.hSet(KEY_COLORS, color.group, JSON.stringify(color))
        await log(entry)
        return
      }
      const { result } = await keycrmBackground(async () => apply(color, await targetsFor(color.wanted, true)))
      const entry = report(color, result, color.urls.length)
      color.replyId = await answer(color.chatId, color.messageId, entry, color.replyId ?? cq.message.message_id, buttons(color, result))
      await r.hSet(KEY_COLORS, color.group, JSON.stringify(color))
      await log(entry)
    } catch (e) {
      const note = e instanceof KeycrmError ? `${e.message} ${e.body.slice(0, 300)}` : (e as Error).message
      await answer(color.chatId, color.messageId, { at: new Date().toISOString(), sku: color.caption, photos: color.urls.length, ok: false, note }, color.replyId)
    }
  })
  return true
}

/** Reacts to the album and replies (or edits the earlier reply), with `markup` buttons if any. Returns the reply's id. */
async function answer(
  chatId: number,
  messageId: number,
  entry: PhotoLogEntry,
  replyId?: number,
  markup?: ReturnType<typeof keyboard>,
): Promise<number | undefined> {
  await tg("setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: entry.undone ? [] : [{ type: "emoji", emoji: entry.ok ? "👌" : entry.waiting ? "👀" : "👎" }],
  }).catch(() => {})
  const mark = entry.undone ? "↩️" : entry.ok ? "✅" : entry.waiting ? "⏳" : "❌"
  const text = `${mark} <b>${esc(entry.sku || "без артикула")}</b>\n${esc(entry.note)}`
  if (replyId) {
    const edited = await tg("editMessageText", {
      chat_id: chatId,
      message_id: replyId,
      text,
      parse_mode: "HTML",
      ...(markup ? { reply_markup: markup } : {}),
    })
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
    ...(markup ? { reply_markup: markup } : {}),
  }).catch((e) => {
    console.error("[telegram-photos] reply:", (e as Error).message)
    return null
  })
  return sent?.message_id
}
