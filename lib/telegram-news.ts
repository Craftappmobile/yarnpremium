// Server-only: what's new in the catalog, posted to the Telegram channel once a
// day by rubric (lib/telegram-rubrics.ts), and sent to the bot's subscribers
// of each rubric (lib/telegram-bot.ts).
//
// Every half hour (app/api/cron/telegram) `watchCatalog` compares the catalog
// with what it saw last time and queues:
//   new   a product in stock for the first time (a new colour);
//   back  a product in stock again after BACK_AFTER_MS or more sold out.
// The very first run only remembers the catalog, so it doesn't post the whole
// shop. Once a day, at POST_HOUR Kyiv time, `publishDaily` posts what is
// queued and still in stock: one post per rubric, promotions that started
// (lib/promo.ts) first, at most MAX_POSTS a day (the rest wait for the next).
//
// Redis keys:
//   tg:seen          hash  sku -> { in, wasIn, outSince } as of the last watch
//   tg:queue         hash  sku -> { kind, at }: waiting for the daily post
//   tg:promos        set   promotions already announced (promoKey)
//   tg:posted:<day>  flag  the day's post went out (Kyiv day)
//   tg:log           list  the last posts, newest first (admin page)

import { type Product, formatPriceShort } from "@/components/shop/data"
import { type Utm, buyUrl } from "@/lib/buy-url"
import { catalogImageUrl } from "@/lib/catalog-image"
import { categoryPath } from "@/lib/category-url"
import { PROMOS, type PromoConfig, promoLabel, promoWindow } from "@/lib/promo"
import { redis } from "@/lib/redis"
import { SITE_URL } from "@/lib/site"
import { botUsername, readSubscribers, removeSubscriber } from "@/lib/telegram-bot"
import { RUBRICS, type Rubric, rubricByKey, rubricOf } from "@/lib/telegram-rubrics"
import { type InlineButton, TelegramError, esc, keyboard, telegramChannel, tg } from "@/lib/telegram"

const KEY_SEEN = "tg:seen"
const KEY_QUEUE = "tg:queue"
const KEY_PROMOS = "tg:promos"
const KEY_LOG = "tg:log"
const postedKey = (day: string) => `tg:posted:${day}`

/**
 * Hour of the daily post, Kyiv time. No study gives Ukrainian Telegram's
 * busiest hour; evening is when people knit and read channels, and the
 * channel's own statistics (views by hour) can move it: TELEGRAM_POST_HOUR.
 * The cron runs at :12 and :42, so the post goes out at hh:12, off the round
 * hour when most channels post.
 */
export const POST_HOUR = (() => {
  const h = Number(process.env.TELEGRAM_POST_HOUR)
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 19
})()
/** Sold out for less than this and back: reserves coming and going, not news. */
const BACK_AFTER_MS = 3 * 24 * 3600_000
/** Posts a day, promotions included. */
const MAX_POSTS = 5
/** Telegram's limit for an album. */
const ALBUM_MAX = 10
const PROMO_PHOTOS = 6
/** Telegram's limit for a caption, in visible characters. */
const CAPTION_MAX = 1024
/** Queued products sold out for this long are dropped. */
const QUEUE_TTL_MS = 14 * 24 * 3600_000
/** A catalog this much smaller than the last one is a KeyCRM hiccup, not a sell-out. */
const SHRINK_GUARD = 0.7

interface Seen {
  in: boolean
  wasIn: boolean
  outSince?: number
}
interface Queued {
  kind: "new" | "back"
  at: number
}

const KYIV = "Europe/Kiev"
export const kyivDay = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: KYIV }).format(t)
export const kyivHour = (t = Date.now()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: KYIV, hour: "numeric", hourCycle: "h23" }).format(t))

// ---------------------------------------------------------------------------
// Watching the catalog

export interface WatchReport {
  seeded?: number
  skipped?: string
  queuedNew?: number
  queuedBack?: number
  inQueue?: number
}

export async function watchCatalog(products: Product[], now = Date.now()): Promise<WatchReport> {
  const r = await redis()
  const seenRaw = await r.hGetAll(KEY_SEEN)
  const seenCount = Object.keys(seenRaw).length
  if (products.length === 0) return { skipped: "catalog is empty" }
  if (seenCount > 20 && products.length < seenCount * SHRINK_GUARD) {
    return { skipped: `catalog shrank from ${seenCount} to ${products.length}` }
  }

  const seeding = seenCount === 0
  const next: Record<string, string> = {}
  const queued: [string, Queued][] = []
  for (const p of products) {
    const inStock = p.stock > 0
    const prev: Seen | undefined = seenRaw[p.sku] ? JSON.parse(seenRaw[p.sku]) : undefined
    if (!seeding && inStock) {
      if (!prev?.wasIn) queued.push([p.sku, { kind: "new", at: now }])
      else if (!prev.in && now - (prev.outSince ?? now) >= BACK_AFTER_MS) queued.push([p.sku, { kind: "back", at: now }])
    }
    // At the first run everything counts as seen in stock, so products sold
    // out then come back as «back», not as new colours.
    const s: Seen = { in: inStock, wasIn: seeding || inStock || Boolean(prev?.wasIn) }
    if (!inStock) s.outSince = prev && !prev.in && prev.outSince ? prev.outSince : now
    next[p.sku] = JSON.stringify(s)
  }

  const tx = r.multi().del(KEY_SEEN).hSet(KEY_SEEN, next)
  // A product already waiting keeps its place (and its kind).
  for (const [sku, q] of queued) tx.hSetNX(KEY_QUEUE, sku, JSON.stringify(q))
  await tx.exec()
  if (seeding) return { seeded: products.length }
  return {
    queuedNew: queued.filter(([, q]) => q.kind === "new").length,
    queuedBack: queued.filter(([, q]) => q.kind === "back").length,
    inQueue: await r.hLen(KEY_QUEUE),
  }
}

// ---------------------------------------------------------------------------
// Posts

export interface NewsItem {
  product: Product
  kind: Queued["kind"]
}

export type Post =
  | { type: "news"; rubric: Rubric; items: NewsItem[] }
  | { type: "promo"; rubric: Rubric; promo: PromoConfig; key: string; products: Product[] }

/** Where a post is read: the channel, or a subscriber's chat with the bot. Goes into the links' UTM tags. */
export type Audience = "channel" | "bot"

export interface Rendered {
  photos: string[]
  caption: string
  buttons: InlineButton[][]
}

const promoKey = (p: PromoConfig) => [p.category, p.name, p.percent, p.price ?? "", p.from ?? "", p.to ?? ""].join("|")

function runningPromos(now: number): PromoConfig[] {
  return PROMOS.filter((p) => {
    const { start, end } = promoWindow(p)
    return now >= start && now < end
  })
}

const sameCategory = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** What the daily post would carry now, in posting order, before the daily limit. */
export async function plannedPosts(products: Product[], now = Date.now()): Promise<{ posts: Post[]; stale: string[] }> {
  const r = await redis()
  const [queueRaw, announced] = await Promise.all([r.hGetAll(KEY_QUEUE), r.sMembers(KEY_PROMOS)])
  const bySku = new Map(products.map((p) => [p.sku, p]))

  const posts: Post[] = []
  for (const promo of runningPromos(now)) {
    const key = promoKey(promo)
    if (announced.includes(key)) continue
    const onSale = products.filter((p) => p.stock > 0 && sameCategory(p.category, promo.category))
    if (onSale.length) posts.push({ type: "promo", rubric: rubricByKey("sale")!, promo, key, products: onSale })
  }

  const stale: string[] = []
  const byRubric = new Map<string, NewsItem[]>()
  for (const [sku, json] of Object.entries(queueRaw)) {
    const q = JSON.parse(json) as Queued
    const product = bySku.get(sku)
    if (!product || product.stock <= 0) {
      if (!product || now - q.at > QUEUE_TTL_MS) stale.push(sku)
      continue
    }
    const key = rubricOf(product.category, product.name).key
    byRubric.set(key, [...(byRubric.get(key) ?? []), { product, kind: q.kind }])
  }
  // Bigger updates first; within a rubric, new colours before restocks, newest first.
  const news = [...byRubric.entries()]
    .map(([key, items]) => ({
      type: "news" as const,
      rubric: rubricByKey(key)!,
      items: items.sort((a, b) => (a.kind === b.kind ? b.product.offerId - a.product.offerId : a.kind === "new" ? -1 : 1)),
    }))
    .sort((a, b) => b.items.length - a.items.length || RUBRICS.indexOf(a.rubric) - RUBRICS.indexOf(b.rubric))
  return { posts: [...posts, ...news], stale }
}

const visibleLength = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot);/g, "_").length

const utmFor = (audience: Audience, rubric: Rubric): Utm => ({
  utm_source: "telegram",
  utm_medium: audience,
  utm_campaign: rubric.key,
})

/** The query part of a site link with the post's UTM tags. */
const withUtm = (path: string, utm: Utm) => `${SITE_URL}${path}?${new URLSearchParams(utm as Record<string, string>)}`

const isByWeight = (p: Product) => p.priceUnit === "г"

function priceText(p: Product): string {
  const per = (v: number) => (isByWeight(p) ? formatPriceShort(Math.round(v * 100)) : formatPriceShort(v))
  const unit = isByWeight(p) ? " / 100 г" : ""
  return p.oldPrice ? `<s>${per(p.oldPrice)}</s> ${per(p.price)}${unit}` : `${per(p.price)}${unit}`
}

function itemLine(p: Product, utm: Utm): string {
  const color = p.color && !p.name.toLowerCase().includes(p.color.toLowerCase()) ? ` — ${p.color}` : ""
  const length = p.length > 0 ? ` · ${p.length} м${isByWeight(p) ? " / 100 г" : ""}` : ""
  return `• <a href="${esc(buyUrl(p.sku, utm))}">${esc(p.name + color)}</a>${esc(length)} · ${priceText(p)}`
}

/** The category with the most products among these: the post's «see all» page. */
function mainCategory(products: Product[]): string {
  const counts = new Map<string, number>()
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
}

const photosOf = (products: Product[], max: number) =>
  products
    .map((p) => p.image)
    .filter((u, i, all) => u && all.indexOf(u) === i)
    .slice(0, max)
    .map(catalogImageUrl)

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function footer(rubric: Rubric, audience: Audience, bot: string | null): string {
  if (audience === "bot") return `\n${rubric.hashtag}\nЗмінити рубрики: /start`
  const subscribe = bot
    ? ` · <a href="https://t.me/${bot}?start=${rubric.key}">🔔 «${esc(rubric.title)}» в особисті</a>`
    : ""
  return `\n${rubric.hashtag}${subscribe}`
}

export function renderPost(post: Post, audience: Audience, bot: string | null): Rendered {
  const utm = utmFor(audience, post.rubric)
  const end = footer(post.rubric, audience, bot)

  if (post.type === "promo") {
    const { promo, products } = post
    const cheapest = products.reduce((a, b) => (b.price < a.price ? b : a))
    const { end: ends } = promoWindow(promo)
    const until = Number.isFinite(ends)
      ? `до ${new Date(ends - 1).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: KYIV })}`
      : "поки є в наявності"
    const categoryUrl = withUtm(categoryPath(promo.category), utm)
    const lines = [
      `🔥 <b>Акція: ${esc(promoLabel(promo))}</b>`,
      `<b>${esc(promo.title ?? promo.category)}</b>${promo.tagline ? ` · ${esc(promo.tagline)}` : ""}`,
      "",
      `Ціна: від ${priceText(cheapest)}`,
      `Діє ${until}`,
      `У наявності ${products.length} ${plural(products.length, "колір", "кольори", "кольорів")}: <a href="${esc(categoryUrl)}">обрати на сайті</a>`,
      end,
    ]
    return {
      photos: photosOf(products, PROMO_PHOTOS),
      caption: lines.join("\n"),
      buttons: [[{ text: "Обрати колір", url: categoryUrl }]],
    }
  }

  const { rubric, items } = post
  const products = items.map((i) => i.product)
  const categoryUrl = withUtm(categoryPath(mainCategory(products)), utm)
  const allBack = items.every((i) => i.kind === "back")
  const head = `${allBack ? "↩️" : "🆕"} <b>${allBack ? "Знову в наявності" : "Оновлення"}: ${esc(rubric.title)}</b>`
  const sections: { title: string; items: NewsItem[] }[] = allBack
    ? [{ title: "", items }]
    : [
        { title: "Нові кольори", items: items.filter((i) => i.kind === "new") },
        { title: "Знову в наявності", items: items.filter((i) => i.kind === "back") },
      ].filter((s) => s.items.length)
  const titled = sections.length > 1

  // As many lines as the caption takes; the rest are counted under «і ще».
  const moreLine = (n: number) => `і ще ${n} — <a href="${esc(categoryUrl)}">дивитися всі</a>`
  const reserve = visibleLength(end) + visibleLength(moreLine(999)) + 4
  let text = head
  let shown = 0
  outer: for (const s of sections) {
    const title = titled ? `\n\n<b>${s.title}:</b>` : "\n"
    let first = true
    for (const item of s.items) {
      const line = `${first ? title : ""}\n${itemLine(item.product, utm)}`
      if (visibleLength(text + line) + reserve > CAPTION_MAX) break outer
      text += line
      first = false
      shown++
    }
  }
  const more = items.length - shown
  text += more > 0 ? `\n${moreLine(more)}\n${end}` : `\n${end}`

  const single = items.length === 1 ? products[0] : null
  return {
    photos: photosOf(products.slice(0, Math.max(shown, 1)), ALBUM_MAX),
    caption: text,
    buttons: single
      ? [[{ text: "Купити", url: buyUrl(single.sku, utm) }, { text: "Уся категорія", url: categoryUrl }]]
      : [[{ text: "Дивитися всі", url: categoryUrl }]],
  }
}

/**
 * Sends a post: an album when it has several photos (Telegram puts no buttons
 * under an album, so its links are in the text), one photo with buttons, or
 * text alone. A photo Telegram can't fetch turns it into text.
 * Returns the photos' file ids, to send the same post on without fetching them again.
 */
export async function sendPost(chatId: string | number, m: Rendered): Promise<{ fileIds: string[] }> {
  const fileIds = (messages: any[]) => messages.map((msg) => msg.photo?.at(-1)?.file_id).filter(Boolean)
  try {
    if (m.photos.length >= 2) {
      const media = m.photos.map((photo, i) => ({
        type: "photo",
        media: photo,
        ...(i === 0 ? { caption: m.caption, parse_mode: "HTML" } : {}),
      }))
      return { fileIds: fileIds(await tg<any[]>("sendMediaGroup", { chat_id: chatId, media })) }
    }
    if (m.photos.length === 1) {
      const msg = await tg("sendPhoto", {
        chat_id: chatId,
        photo: m.photos[0],
        caption: m.caption,
        parse_mode: "HTML",
        reply_markup: keyboard(m.buttons),
      })
      return { fileIds: fileIds([msg]) }
    }
  } catch (e) {
    // Blocked or a wrong chat: no point retrying as text.
    if (!(e instanceof TelegramError) || e.code !== 400 || !/photo|file|media|url|image/i.test(e.description)) throw e
    console.warn("[telegram] photos failed, sending text:", e.message)
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: m.caption,
    parse_mode: "HTML",
    reply_markup: keyboard(m.buttons),
    link_preview_options: { is_disabled: true },
  })
  return { fileIds: [] }
}

// ---------------------------------------------------------------------------
// The daily post

export interface PublishReport {
  day: string
  posted: { rubric: string; type: Post["type"]; products: number }[]
  failed?: string[]
  leftForTomorrow?: number
  dropped?: number
  subscribers?: { sent: number; removed: number; failed: number; unfinished?: boolean }
}

export interface LogEntry {
  at: string
  rubric: string
  title: string
  type: Post["type"]
  products: number
}

export async function publishDaily(products: Product[], deadline: number, now = Date.now()): Promise<PublishReport | null> {
  const r = await redis()
  const day = kyivDay(now)
  // Taken before posting, so two runs in the same hour can't both post.
  if (!(await r.set(postedKey(day), new Date(now).toISOString(), { NX: true, EX: 3 * 24 * 3600 }))) return null

  const { posts, stale } = await plannedPosts(products, now)
  if (stale.length) await r.hDel(KEY_QUEUE, stale)
  const today = posts.slice(0, MAX_POSTS)
  const bot = await botUsername().catch(() => null)
  const channel = telegramChannel()

  const report: PublishReport = { day, posted: [], dropped: stale.length }
  const sent: { post: Post; fileIds: string[] }[] = []
  for (const post of today) {
    const rendered = renderPost(post, "channel", bot)
    try {
      const { fileIds } = await sendPost(channel, rendered)
      sent.push({ post, fileIds })
      const count = post.type === "promo" ? post.products.length : post.items.length
      report.posted.push({ rubric: post.rubric.key, type: post.type, products: count })
      if (post.type === "promo") await r.sAdd(KEY_PROMOS, post.key)
      else await r.hDel(KEY_QUEUE, post.items.map((i) => i.product.sku))
      const entry: LogEntry = {
        at: new Date().toISOString(),
        rubric: post.rubric.title,
        title: post.type === "promo" ? promoLabel(post.promo) : `${post.rubric.title}: ${count} ${plural(count, "товар", "товари", "товарів")}`,
        type: post.type,
        products: count,
      }
      await r.multi().lPush(KEY_LOG, JSON.stringify(entry)).lTrim(KEY_LOG, 0, 99).exec()
    } catch (e) {
      ;(report.failed ??= []).push(`${post.rubric.key}: ${(e as Error).message}`)
    }
    // Telegram allows about 20 messages a minute to one channel; an album counts per photo.
    await new Promise((res) => setTimeout(res, 3000))
  }
  report.leftForTomorrow = posts.length - today.length

  if (sent.length) report.subscribers = await deliverToSubscribers(sent, bot, deadline)
  return report
}

export async function readPostLog(limit = 30): Promise<LogEntry[]> {
  const r = await redis()
  return (await r.lRange(KEY_LOG, 0, limit - 1)).map((json) => JSON.parse(json))
}

export async function queueSize(): Promise<number> {
  return (await redis()).hLen(KEY_QUEUE)
}

/**
 * Sends the day's posts on to the bot's subscribers, each only the rubrics
 * they chose. People who blocked the bot are dropped. Stops at `deadline`
 * (the function's time limit); whoever is left gets the next day's post.
 */
async function deliverToSubscribers(
  sent: { post: Post; fileIds: string[] }[],
  bot: string | null,
  deadline: number,
): Promise<NonNullable<PublishReport["subscribers"]>> {
  const subscribers = await readSubscribers()
  const result = { sent: 0, removed: 0, failed: 0, unfinished: false }
  for (const [chatId, rubrics] of subscribers) {
    const theirs = sent.filter((s) => rubrics.includes(s.post.rubric.key))
    for (const { post, fileIds } of theirs) {
      if (Date.now() > deadline) {
        result.unfinished = true
        return result
      }
      const rendered = renderPost(post, "bot", bot)
      // The channel's copies of the photos, so Telegram doesn't fetch them for every subscriber.
      if (fileIds.length === rendered.photos.length) rendered.photos = fileIds
      try {
        await sendPost(chatId, rendered)
        result.sent++
      } catch (e) {
        if (e instanceof TelegramError && (e.code === 403 || /chat not found/i.test(e.description))) {
          await removeSubscriber(chatId)
          result.removed++
          break
        }
        result.failed++
        console.warn("[telegram] subscriber", chatId, (e as Error).message)
      }
      // Well under Telegram's 30 messages a second.
      await new Promise((res) => setTimeout(res, 50))
    }
  }
  return result
}
