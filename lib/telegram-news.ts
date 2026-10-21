// Server-only: what's new in the catalog, posted to the Telegram channel once a
// day by rubric (lib/telegram-rubrics.ts; «категорії» to buyers), and sent to
// the bot's subscribers as one message with their rubrics only
// (lib/telegram-bot.ts).
//
// Every half hour (app/api/cron/telegram) `watchCatalog` compares the catalog
// with what it saw last time and queues:
//   new   a product in stock for the first time (a new colour);
//   back  a product in stock again after BACK_AFTER_MS or more sold out, and
//         not announced in the last REPEAT_AFTER_MS.
// The very first run only remembers the catalog, so it doesn't post the whole
// shop. Once a day, at POST_HOUR Kyiv time, `publishDaily` posts what is
// queued and still in stock, keeping the channel short: promotions that
// started (lib/promo.ts) first, a post of its own for a rubric with
// OWN_POST_MIN or more products, the rest together in one «Новинки дня»; at
// most MAX_POSTS posts. Each product is posted once. The first daily post is
// preceded by a pinned «how to order» post.
//
// Redis keys:
//   tg:seen          hash  sku -> { in, wasIn, outSince, announcedAt } as of the last watch
//   tg:queue         hash  sku -> { kind, at }: waiting for the daily post
//   tg:promos        set   promotions already announced (promoKey)
//   tg:intro         flag  the pinned «how to order» post went out
//   tg:posted:<day>  flag  the day's post went out (Kyiv day)
//   tg:log           list  the last posts, newest first (admin page)

import { type Product, formatPriceShort, isRemnant } from "@/components/shop/data"
import { type Utm, buyUrl } from "@/lib/buy-url"
import { catalogImageUrl } from "@/lib/catalog-image"
import { categoryPath } from "@/lib/category-url"
import { PROMOS, type PromoConfig, promoLabel, promoWindow } from "@/lib/promo"
import { redis } from "@/lib/redis"
import { SITE_URL } from "@/lib/site"
import { botUsername, readSubscribers, removeSubscriber } from "@/lib/telegram-bot"
import { RUBRICS, type Rubric, rubricByKey, rubricOf } from "@/lib/telegram-rubrics"
import { countTelegram } from "@/lib/telegram-stats"
import { CATEGORY_NOTES } from "@/lib/categories"
import { MAX_TILES, collage, fullGrid } from "@/lib/telegram-collage"
import { colourOf, spoolKey } from "@/lib/telegram-photos"
import { type InlineButton, TelegramError, esc, keyboard, telegramChannel, tg } from "@/lib/telegram"

const KEY_SEEN = "tg:seen"
const KEY_QUEUE = "tg:queue"
const KEY_PROMOS = "tg:promos"
const KEY_INTRO = "tg:intro"
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
/** A product announced this recently isn't announced again when it comes back. */
const REPEAT_AFTER_MS = 30 * 24 * 3600_000
/** Posts a day in the channel, promotions included. */
export const MAX_POSTS = 3
/** A rubric with fewer new products than this shares the day's «Новинки дня» post. */
const OWN_POST_MIN = 3
const PROMO_PHOTOS = 6
/** Telegram's limit for a caption, in visible characters. */
const CAPTION_MAX = 1024
/** Queued products sold out for this long are dropped. */
const QUEUE_TTL_MS = 14 * 24 * 3600_000
/** A catalog this much smaller than the last one is a KeyCRM hiccup, not a sell-out. */
const SHRINK_GUARD = 0.7

/** Under every post: buyers don't expect a channel link to fill the cart. */
const HOW_TO_ORDER = "🛒 Натисніть назву — товар одразу в кошику, кількість зміните при оформленні."
/** A promotion's post lists no products, only its page. */
const HOW_TO_ORDER_PROMO = "🛒 Оберіть колір на сайті — кількість зміните при оформленні."

interface Seen {
  in: boolean
  wasIn: boolean
  outSince?: number
  announcedAt?: number
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
    // A spool end under the minimum is on sale, but no news (components/shop/data.ts).
    const inStock = p.stock > 0 && !isRemnant(p)
    const prev: Seen | undefined = seenRaw[p.sku] ? JSON.parse(seenRaw[p.sku]) : undefined
    if (!seeding && inStock) {
      const announcedLately = prev?.announcedAt !== undefined && now - prev.announcedAt < REPEAT_AFTER_MS
      if (!prev?.wasIn) queued.push([p.sku, { kind: "new", at: now }])
      else if (!prev.in && now - (prev.outSince ?? now) >= BACK_AFTER_MS && !announcedLately) {
        queued.push([p.sku, { kind: "back", at: now }])
      }
    }
    // At the first run everything counts as seen in stock, so products sold
    // out then come back as «back», not as new colours.
    const s: Seen = { in: inStock, wasIn: seeding || inStock || Boolean(prev?.wasIn) }
    if (!inStock) s.outSince = prev && !prev.in && prev.outSince ? prev.outSince : now
    if (prev?.announcedAt) s.announcedAt = prev.announcedAt
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

/** Remembers when products were posted, so they aren't posted again soon (watchCatalog). */
async function markAnnounced(skus: string[], now: number): Promise<void> {
  if (!skus.length) return
  const r = await redis()
  const raw = await r.hmGet(KEY_SEEN, skus)
  const updates: Record<string, string> = {}
  skus.forEach((sku, i) => {
    const s: Seen = raw[i] ? JSON.parse(raw[i]!) : { in: true, wasIn: true }
    updates[sku] = JSON.stringify({ ...s, announcedAt: now })
  })
  await r.hSet(KEY_SEEN, updates)
}

// ---------------------------------------------------------------------------
// Posts

export interface NewsItem {
  /** The product the line links to; for several spools of one colour, the one with the most yarn. */
  product: Product
  kind: Queued["kind"]
  rubric: Rubric
  /** Several spools of one colour (MO377-1, MO377-2…) in one line and one tile, the most yarn first. */
  spools?: Product[]
}

/** Every product an item stands for. */
const productsOf = (item: NewsItem) => item.spools ?? [item.product]

/** The spool's number: «2» for «MO377 - 2»; none for a SKU that isn't a spool's. */
const spoolNumber = (sku: string) => spoolKey(sku).match(/-(\d+)$/)?.[1]

/**
 * Spools of one colour arrive together, each a KeyCRM product of its own with
 * the same photos: one line and one tile for them, not a tile each. Spools
 * are yarn by weight whose SKUs differ in the last number only, in the same
 * category, with the same colour.
 */
export function mergeSpools(items: NewsItem[]): NewsItem[] {
  const groups = new Map<string, NewsItem[]>()
  for (const item of items) {
    const p = item.product
    const key = isByWeight(p) && spoolNumber(p.sku)
      ? [colourOf(spoolKey(p.sku)), p.category.trim().toLowerCase(), (p.color ?? "").trim().toLowerCase()].join("|")
      : `sku|${p.sku}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]
    const spools = group.map((i) => i.product).sort((a, b) => b.stock - a.stock)
    return {
      product: spools[0],
      kind: group.some((i) => i.kind === "new") ? "new" : "back",
      rubric: group[0].rubric,
      spools,
    }
  })
}

/**
 * A news post covers one rubric, or several (`rubric: null`): the day's
 * smaller updates together.
 */
export type Post =
  | { type: "news"; rubric: Rubric | null; items: NewsItem[] }
  | { type: "promo"; rubric: Rubric; promo: PromoConfig; key: string; products: Product[] }

/** Where a post is read: the channel, or a subscriber's chat with the bot. Goes into the links' UTM tags. */
export type Audience = "channel" | "bot"

export interface Rendered {
  /** Photo URLs or Telegram file ids; numbered ones match the numbers in the text. */
  photos: string[]
  /** The text numbers its products 1… in the order of `photos`: their collage gets the same numbers. */
  numbered?: boolean
  caption: string
  buttons: InlineButton[][]
}

/** The rubrics a post carries. */
export const postRubrics = (post: Post): Rubric[] =>
  post.type === "promo" || post.rubric
    ? [post.rubric!]
    : RUBRICS.filter((r) => post.items.some((i) => i.rubric.key === r.key))

const promoKey = (p: PromoConfig) => [p.category, p.name, p.percent, p.price ?? "", p.from ?? "", p.to ?? ""].join("|")

function runningPromos(now: number): PromoConfig[] {
  return PROMOS.filter((p) => {
    const { start, end } = promoWindow(p)
    return now >= start && now < end
  })
}

const sameCategory = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** New colours before restocks; those with a photo first, so the picture shows them; then newest first. */
const byNews = (a: NewsItem, b: NewsItem) =>
  a.kind !== b.kind
    ? a.kind === "new" ? -1 : 1
    : Boolean(b.product.image) !== Boolean(a.product.image)
      ? a.product.image ? -1 : 1
      : b.product.offerId - a.product.offerId

/** What the next daily post will carry, in posting order: at most MAX_POSTS posts. */
export async function plannedPosts(products: Product[], now = Date.now()): Promise<{ posts: Post[]; stale: string[] }> {
  const r = await redis()
  const [queueRaw, announced] = await Promise.all([r.hGetAll(KEY_QUEUE), r.sMembers(KEY_PROMOS)])
  const bySku = new Map(products.map((p) => [p.sku, p]))

  const promos: Post[] = []
  for (const promo of runningPromos(now)) {
    const key = promoKey(promo)
    if (announced.includes(key)) continue
    const onSale = products.filter((p) => p.stock > 0 && !isRemnant(p) && sameCategory(p.category, promo.category))
    if (onSale.length) promos.push({ type: "promo", rubric: rubricByKey("sale")!, promo, key, products: onSale })
  }

  const stale: string[] = []
  const byRubric = new Map<string, NewsItem[]>()
  for (const [sku, json] of Object.entries(queueRaw)) {
    const q = JSON.parse(json) as Queued
    const product = bySku.get(sku)
    if (!product || product.stock <= 0 || isRemnant(product)) {
      if (!product || now - q.at > QUEUE_TTL_MS) stale.push(sku)
      continue
    }
    const rubric = rubricOf(product.category, product.name)
    byRubric.set(rubric.key, [...(byRubric.get(rubric.key) ?? []), { product, kind: q.kind, rubric }])
  }
  return { posts: arrangePosts(promos, [...byRubric.values()].map(mergeSpools)), stale }
}

/**
 * The day's posts, at most MAX_POSTS: promotions take their slots first (one
 * is left for the news, if any); the biggest rubrics get posts of their own
 * while slots last, the rest share the last one.
 */
export function arrangePosts(promos: Post[], rubricItems: NewsItem[][]): Post[] {
  const groups = rubricItems
    .filter((items) => items.length)
    .map((items) => [...items].sort(byNews))
    .sort((a, b) => b.length - a.length || RUBRICS.indexOf(a[0].rubric) - RUBRICS.indexOf(b[0].rubric))
  const today = promos.slice(0, Math.max(0, MAX_POSTS - (groups.length ? 1 : 0)))
  let slots = MAX_POSTS - today.length
  const own: Post[] = []
  const shared: NewsItem[] = []
  groups.forEach((items, i) => {
    const lastSlot = slots === 1 && i < groups.length - 1
    if (slots > 0 && items.length >= OWN_POST_MIN && !lastSlot) {
      own.push({ type: "news", rubric: items[0].rubric, items })
      slots--
    } else shared.push(...items)
  })
  if (shared.length && slots > 0) {
    const one = shared.every((i) => i.rubric.key === shared[0].rubric.key)
    own.push({ type: "news", rubric: one ? shared[0].rubric : null, items: shared })
  }
  return [...today, ...own]
}

const visibleLength = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot);/g, "_").length

const utmFor = (audience: Audience, campaign: string): Utm => ({
  utm_source: "telegram",
  utm_medium: audience,
  utm_campaign: campaign,
})

/** A site link with the post's UTM tags. */
const withUtm = (path: string, utm: Utm) => `${SITE_URL}${path}?${new URLSearchParams(utm as Record<string, string>)}`

const isByWeight = (p: Product) => p.priceUnit === "г"

function priceText(p: Product): string {
  const per = (v: number) => (isByWeight(p) ? formatPriceShort(Math.round(v * 100)) : formatPriceShort(v))
  const unit = isByWeight(p) ? " / 100 г" : ""
  return p.oldPrice ? `<s>${per(p.oldPrice)}</s> ${per(p.price)}${unit}` : `${per(p.price)}${unit}`
}

/** The numbers on the collage's tiles, as the text writes them. */
const KEYCAPS = ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"]

/**
 * What the yarn is made of, unless the name says it already («80%Меринос
 * 20%ПА»): the «Склад» from KeyCRM, else the line about the whole category.
 */
function composition(p: Product): string {
  if (p.name.includes("%")) return ""
  const field = p.specs?.find((s) => s.name === "Склад")?.value
  return (field ?? CATEGORY_NOTES[p.category] ?? "").trim()
}

/** «180 м і 215 ₴ за 100 г», the promotional price after the struck-through one. */
function amounts(p: Product): string {
  const price = (v: number) => (isByWeight(p) ? formatPriceShort(Math.round(v * 100)) : formatPriceShort(v))
  const now = p.oldPrice ? `<s>${price(p.oldPrice)}</s> ${price(p.price)}` : price(p.price)
  if (!isByWeight(p)) return `${now} за шт`
  return `${p.length > 0 ? `${p.length} м і ` : ""}${now} за 100 г`
}

/** One product: its number on the collage (or a bullet), its name linking to the purchase, colour, composition, amounts. */
function itemLine(item: NewsItem, utm: Utm, markBack: boolean, num?: number): string {
  const p = item.product
  const spools = item.spools ?? []
  // «Мохер - альпака MO377 - 2» stands for all the colour's spools: «Мохер - альпака MO377».
  const n = spools.length > 1 ? spoolNumber(p.sku) : undefined
  const name = n ? p.name.replace(new RegExp(`(\\d)\\s*[-–—]\\s*${n}(?!\\d)`), "$1") : p.name
  const weights = spools.map((s) => Math.round(s.stock))
  const spoolText = n
    ? ` · ${spools.length} ${plural(spools.length, "бобіна", "бобіни", "бобін")}: ${weights.slice(0, -1).join(", ")} і ${weights.at(-1)} г`
    : ""
  const color = p.color && !p.name.toLowerCase().includes(p.color.toLowerCase()) ? ` — ${p.color}` : ""
  const made = composition(p)
  const back = markBack && item.kind === "back" ? " · знову є" : ""
  const mark = num ? `${KEYCAPS[num]} ` : "• "
  return `${mark}<a href="${esc(buyUrl(p.sku, utm))}">${esc(name + color)}</a>${made ? ` · ${esc(made)}` : ""} · ${amounts(p)}${spoolText}${back}`
}

/** The category with the most products among these: the «see all» page. */
function mainCategory(products: Product[]): string {
  const counts = new Map<string, number>()
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
}

/** Photos for a picture without numbers (a promotion's): distinct ones, up to `max`. */
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

interface Section {
  /** Bold line over the products (HTML); none for a post's only section. */
  title?: string
  /** The site category «і ще N» leads to, named on the section's button. */
  category?: string
  items: NewsItem[]
  /** Where «і ще N» leads. */
  moreUrl: string
}

/** The caption with `limits[i]` lines of section i, numbered as `numbers` says. */
function renderSections(
  head: string,
  sections: Section[],
  end: string,
  utm: Utm,
  markBack: boolean,
  limits: number[],
  numbers: Map<string, number>,
): { text: string; shown: NewsItem[] } {
  let text = head
  const shown: NewsItem[] = []
  sections.forEach((s, i) => {
    text += s.title ? `\n\n<b>${s.title}</b>` : "\n"
    for (const item of s.items.slice(0, limits[i])) {
      text += `\n${itemLine(item, utm, markBack, numbers.get(item.product.sku))}`
      shown.push(item)
    }
    const more = s.items.length - limits[i]
    if (more > 0) {
      const what = limits[i] === 0 ? `${more} ${plural(more, "новинка", "новинки", "новинок")}` : `і ще ${more}`
      text += `\n<a href="${esc(s.moreUrl)}">${what} — дивитися всі</a>`
    }
  })
  return { text: `${text}\n\n${end}`, shown }
}

/**
 * Head, sections and footer in one caption of at most CAPTION_MAX visible
 * characters: sections lose their last lines, largest first, and say how many
 * more there are instead. The listed products with a photo, up to a collage
 * of whole rows, are numbered 1… in the text; `photos` are theirs, in order.
 */
function fitSections(
  head: string,
  sections: Section[],
  end: string,
  utm: Utm,
  markBack: boolean,
): { text: string; shown: Product[]; photos: string[] } {
  // Fitted as if every line had a number, the widest mark, so numbering fewer can only shorten it.
  const widest = new Map(sections.flatMap((s) => s.items.map((i) => [i.product.sku, 9] as [string, number])))
  const limits = sections.map((s) => s.items.length)
  for (;;) {
    const { text } = renderSections(head, sections, end, utm, markBack, limits, widest)
    if (visibleLength(text) <= CAPTION_MAX) break
    const largest = limits.indexOf(Math.max(...limits))
    if (limits[largest] === 0) break
    limits[largest]--
  }
  const listed = renderSections(head, sections, end, utm, markBack, limits, new Map()).shown
  const withPhoto = listed.filter((i) => i.product.image)
  const pictured = withPhoto.slice(0, fullGrid(Math.min(MAX_TILES, withPhoto.length)))
  const numbers = new Map(pictured.map((i, k) => [i.product.sku, k + 1]))
  const { text, shown } = renderSections(head, sections, end, utm, markBack, limits, numbers)
  return {
    text,
    shown: shown.map((i) => i.product),
    photos: pictured.map((i) => catalogImageUrl(i.product.image)),
  }
}

function channelFooter(rubrics: Rubric[], bot: string | null, hint = HOW_TO_ORDER): string {
  const tags = rubrics.map((r) => r.hashtag).join(" ")
  if (!bot) return `${hint}\n${tags}`
  const one = rubrics.length === 1 ? rubrics[0] : null
  const subscribe = one
    ? `<a href="https://t.me/${bot}?start=${one.key}">🔔 Лише «${esc(one.title)}» в особисті</a>`
    : `<a href="https://t.me/${bot}?start">🔔 Лише ваші категорії в особисті</a>`
  return `${hint}\n${tags} · ${subscribe}`
}

function renderPromo(post: Extract<Post, { type: "promo" }>, utm: Utm, end: string): { caption: string; url: string } {
  const { promo, products } = post
  const cheapest = products.reduce((a, b) => (b.price < a.price ? b : a))
  const { end: ends } = promoWindow(promo)
  const until = Number.isFinite(ends)
    ? `до ${new Date(ends - 1).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: KYIV })}`
    : "поки є в наявності"
  const url = withUtm(categoryPath(promo.category), utm)
  const lines = [
    `🔥 <b>Акція: ${esc(promoLabel(promo))}</b>`,
    `<b>${esc(promo.title ?? promo.category)}</b>${promo.tagline ? ` · ${esc(promo.tagline)}` : ""}`,
    "",
    `Ціна: від ${priceText(cheapest)}`,
    `Діє ${until}`,
    `У наявності ${products.length} ${plural(products.length, "колір", "кольори", "кольорів")}: <a href="${esc(url)}">обрати на сайті</a>`,
    "",
    end,
  ]
  return { caption: lines.join("\n"), url }
}

/** A post as the channel shows it. */
export function renderPost(post: Post, bot: string | null): Rendered {
  const rubrics = postRubrics(post)
  const utm = utmFor("channel", post.rubric?.key ?? "mixed")
  const end = channelFooter(rubrics, bot, post.type === "promo" ? HOW_TO_ORDER_PROMO : HOW_TO_ORDER)

  if (post.type === "promo") {
    const { caption, url } = renderPromo(post, utm, end)
    return {
      photos: photosOf(post.products, PROMO_PHOTOS),
      caption,
      buttons: [[{ text: "🔥 Обрати колір зі знижкою", url, style: "success" }]],
    }
  }

  const { rubric, items } = post
  const products = items.map((i) => i.product)
  const categoryUrl = withUtm(categoryPath(mainCategory(products)), utm)
  let head: string
  let sections: Section[]
  if (rubric) {
    const allBack = items.every((i) => i.kind === "back")
    head = `${allBack ? "↩️" : "🆕"} <b>${allBack ? "Знову в наявності" : "Новинки"}: ${esc(rubric.title)}</b>`
    const split = [
      { title: "Нові кольори", items: items.filter((i) => i.kind === "new"), moreUrl: categoryUrl },
      { title: "Знову в наявності", items: items.filter((i) => i.kind === "back"), moreUrl: categoryUrl },
    ].filter((s) => s.items.length)
    sections = split.length > 1 ? split : [{ items, moreUrl: categoryUrl }]
  } else {
    head = "🆕 <b>Новинки дня</b>"
    sections = rubrics.map((r) => {
      const theirs = items.filter((i) => i.rubric.key === r.key)
      return {
        title: esc(r.title),
        category: mainCategory(theirs.map((i) => i.product)),
        items: theirs,
        moreUrl: withUtm(categoryPath(mainCategory(theirs.map((i) => i.product))), utm),
      }
    })
  }
  const { text, photos } = fitSections(head, sections, end, utm, !rubric)

  const single = items.length === 1 ? products[0] : null
  return {
    photos,
    numbered: photos.length > 1,
    caption: text,
    buttons: single
      ? [[
          { text: "🛒 Купити", url: buyUrl(single.sku, utm), style: "success" },
          { text: "🧶 Уся категорія", url: categoryUrl, style: "primary" },
        ]]
      : rubric
        ? [[{ text: "🧶 Дивитися всі на сайті", url: categoryUrl, style: "success" }]]
        : sectionButtons(sections),
  }
}

/**
 * A green button per site category the sections lead to, two to a row, named
 * after the category: new yarn of several kinds often comes in one stock lot,
 * and a «Кашемір» button opening «Сток Шанель» would mislead.
 */
function sectionButtons(sections: Section[]): InlineButton[][] {
  const pages = [...new Map(sections.map((s) => [s.moreUrl, s.category ?? ""])).entries()]
  const buttons: InlineButton[] = pages.map(([url, category]) => ({
    text: pages.length === 1 || !category ? "🧶 Дивитися всі на сайті" : `🧶 ${category}`,
    url,
    style: "success",
  }))
  // Two to a row while the names are short enough not to be cut off.
  const perRow = buttons.every((b) => b.text.length <= 18) ? 2 : 1
  const rows: InlineButton[][] = []
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow))
  return rows
}

/**
 * One subscriber's message of the day: what the day's posts carried in their
 * rubrics, in one photo with one caption, however many rubrics they follow.
 */
export function renderDigest(posts: Post[], rubricKeys: string[]): Rendered | null {
  const utm = utmFor("bot", "digest")
  const promos = posts.filter((p): p is Extract<Post, { type: "promo" }> => p.type === "promo" && rubricKeys.includes("sale"))
  const items = posts.flatMap((p) => (p.type === "news" ? p.items.filter((i) => rubricKeys.includes(i.rubric.key)) : []))
  if (!promos.length && !items.length) return null

  const promoLines = promos.map((p) => {
    const url = withUtm(categoryPath(p.promo.category), utm)
    return `🔥 <b>Акція: ${esc(promoLabel(p.promo))}</b> — ${esc(p.promo.title ?? p.promo.category)}, <a href="${esc(url)}">обрати колір</a>`
  })
  const head = `🧶 <b>Новинки ваших категорій</b>${promoLines.length ? `\n\n${promoLines.join("\n")}` : ""}`
  const sections: Section[] = RUBRICS.filter((r) => items.some((i) => i.rubric.key === r.key)).map((r) => {
    const theirs = items.filter((i) => i.rubric.key === r.key).sort(byNews)
    return {
      title: esc(r.title),
      category: mainCategory(theirs.map((i) => i.product)),
      items: theirs,
      moreUrl: withUtm(categoryPath(mainCategory(theirs.map((i) => i.product))), utm),
    }
  })
  const hint = items.length ? HOW_TO_ORDER : HOW_TO_ORDER_PROMO
  const { text, photos } = fitSections(head, sections, `${hint}\nЗмінити категорії: /start`, utm, true)
  // Only promotions: their photos, unnumbered.
  const promoPhotos = photos.length ? [] : photosOf(promos.flatMap((p) => p.products), 4)
  return {
    photos: photos.length ? photos : promoPhotos,
    numbered: photos.length > 1,
    caption: text,
    buttons: sectionButtons(sections),
  }
}

/**
 * Sends a post: several photos tiled into one picture (lib/telegram-collage.ts)
 * with the buttons under it, one photo with buttons, or text alone. When the
 * picture can't be made the photos go as an album, which Telegram shows
 * without buttons (its links are in the text). A photo Telegram can't fetch
 * turns the post into text.
 * Returns the photos' file ids, to send them on without fetching them again.
 */
export async function sendPost(chatId: string | number, m: Rendered): Promise<{ fileIds: string[]; messageId?: number }> {
  const fileIds = (messages: any[]) => messages.map((msg) => msg.photo?.at(-1)?.file_id).filter(Boolean)
  const markup = m.buttons.length ? { reply_markup: keyboard(m.buttons) } : {}
  try {
    if (m.photos.length >= 2) {
      const picture = await collage(m.photos, m.numbered).catch((e: Error) => {
        console.warn("[telegram] collage failed:", e.message)
        return null
      })
      if (picture) {
        const msg = await tg(
          "sendPhoto",
          { chat_id: chatId, caption: m.caption, parse_mode: "HTML", ...markup },
          { field: "photo", data: picture, name: "novynky.jpg", type: "image/jpeg" },
        )
        return { fileIds: fileIds([msg]), messageId: msg.message_id }
      }
      const media = m.photos.map((photo, i) => ({
        type: "photo",
        media: photo,
        ...(i === 0 ? { caption: m.caption, parse_mode: "HTML" } : {}),
      }))
      const messages = await tg<any[]>("sendMediaGroup", { chat_id: chatId, media })
      return { fileIds: fileIds(messages), messageId: messages[0]?.message_id }
    }
    if (m.photos.length === 1) {
      const msg = await tg("sendPhoto", { chat_id: chatId, photo: m.photos[0], caption: m.caption, parse_mode: "HTML", ...markup })
      return { fileIds: fileIds([msg]), messageId: msg.message_id }
    }
  } catch (e) {
    // Blocked or a wrong chat: no point retrying as text.
    if (!(e instanceof TelegramError) || e.code !== 400 || !/photo|file|media|url|image/i.test(e.description)) throw e
    console.warn("[telegram] photos failed, sending text:", e.message)
  }
  const msg = await tg("sendMessage", {
    chat_id: chatId,
    text: m.caption,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...markup,
  })
  return { fileIds: [], messageId: msg.message_id }
}

// ---------------------------------------------------------------------------
// The pinned «how to order» post

export function introPost(bot: string | null): Rendered {
  const tags = RUBRICS.map((r) => r.hashtag).join(" ")
  const caption = [
    "📌 <b>Як замовити пряжу з каналу</b>",
    "",
    `Новинки й акції SINCERITA виходять тут увечері о ${POST_HOUR}:12, по категоріях: ${tags}. Лише в дні, коли є нове, і без повторів.`,
    "",
    "🖼 <b>Як дивитися колір.</b> У пості колаж фото: номер на фото відповідає номеру біля назви товару. Натисніть на колаж, щоб роздивитися його на весь екран.",
    "",
    "🛒 <b>Замовлення в один дотик.</b> Натисніть назву товару в пості — він одразу опиниться в кошику на сайті, на сторінці оформлення. Там можна змінити кількість (від 100 г, кашемір від 50 г), додати інші товари й обрати доставку та оплату.",
    "",
    bot
      ? `🔔 <b>Лише свої категорії.</b> Бот @${bot} надсилає одне повідомлення ввечері, коли є нове, — тільки з категоріями, які ви оберете. Що вже показав, не повторює.`
      : "",
  ]
    .filter((l, i, all) => l || all[i - 1])
    .join("\n")
  return {
    photos: [],
    caption,
    buttons: [
      [{ text: "🛍 Перейти на сайт", url: withUtm("/", utmFor("channel", "intro")), style: "primary" }],
      ...(bot ? [[{ text: "🔔 Обрати свої категорії", url: `https://t.me/${bot}?start`, style: "success" as const }]] : []),
    ],
  }
}

/** When the «how to order» post went out, and which message it is (to unpin it when it is replaced). */
export interface IntroState {
  at: string
  messageId?: number
  pinned?: boolean
}

export async function readIntro(): Promise<IntroState | null> {
  const raw = await (await redis()).get(KEY_INTRO)
  if (!raw) return null
  // The first version stored only the time.
  return raw.startsWith("{") ? JSON.parse(raw) : { at: raw }
}

/**
 * Posts and pins the «how to order» post; a previous one is unpinned, so the
 * channel shows the current text. Pinning in a channel needs the bot's «Edit
 * messages» right; without it the post goes out unpinned and `pinned` is false.
 */
export async function publishIntro(): Promise<IntroState & { pinError?: string }> {
  const r = await redis()
  const channel = telegramChannel()
  const bot = await botUsername().catch(() => null)
  const before = await readIntro()
  const { messageId } = await sendPost(channel, introPost(bot))
  const pinError = await tg("pinChatMessage", { chat_id: channel, message_id: messageId, disable_notification: true })
    .then(() => undefined)
    .catch((e: Error) => e.message)
  if (!pinError && before?.messageId) {
    await tg("unpinChatMessage", { chat_id: channel, message_id: before.messageId }).catch(() => {})
  }
  const state: IntroState = { at: new Date().toISOString(), messageId, pinned: !pinError }
  await r.set(KEY_INTRO, JSON.stringify(state))
  return { ...state, ...(pinError ? { pinError } : {}) }
}

/** Posts and pins the «how to order» post once, before the first daily post. */
async function ensureIntro(): Promise<string | undefined> {
  if (await readIntro()) return undefined
  const result = await publishIntro()
  return result.pinned ? "pinned" : `posted, not pinned: ${result.pinError}`
}

// ---------------------------------------------------------------------------
// The daily post

export interface PublishReport {
  day: string
  intro?: string
  posted: { rubric: string; type: Post["type"]; products: number }[]
  failed?: string[]
  dropped?: number
  subscribers?: { sent: number; removed: number; failed: number; unfinished?: boolean }
}

export interface LogEntry {
  at: string
  title: string
  type: Post["type"]
  products: number
}

function logTitle(post: Post): string {
  if (post.type === "promo") return `Акція: ${promoLabel(post.promo)}`
  const n = post.items.length
  const what = `${n} ${plural(n, "товар", "товари", "товарів")}`
  return post.rubric ? `${post.rubric.title}: ${what}` : `Новинки дня (${postRubrics(post).map((r) => r.title).join(", ")}): ${what}`
}

export async function publishDaily(products: Product[], deadline: number, now = Date.now()): Promise<PublishReport | null> {
  const r = await redis()
  const day = kyivDay(now)
  // Taken before posting, so two runs in the same hour can't both post.
  if (!(await r.set(postedKey(day), new Date(now).toISOString(), { NX: true, EX: 3 * 24 * 3600 }))) return null

  const { posts, stale } = await plannedPosts(products, now)
  if (stale.length) await r.hDel(KEY_QUEUE, stale)
  const report: PublishReport = { day, posted: [], dropped: stale.length }
  if (!posts.length) return report

  const bot = await botUsername().catch(() => null)
  const channel = telegramChannel()
  report.intro = await ensureIntro().catch((e: Error) => `failed: ${e.message}`)

  const sent: { post: Post; fileIds: string[] }[] = []
  for (const post of posts) {
    try {
      const { fileIds } = await sendPost(channel, renderPost(post, bot))
      sent.push({ post, fileIds })
      const count = post.type === "promo" ? post.products.length : post.items.length
      report.posted.push({ rubric: post.rubric?.key ?? "mixed", type: post.type, products: count })
      if (post.type === "promo") await r.sAdd(KEY_PROMOS, post.key)
      else {
        const skus = post.items.flatMap((i) => productsOf(i).map((p) => p.sku))
        await r.hDel(KEY_QUEUE, skus)
        await markAnnounced(skus, now)
      }
      await countTelegram({ posts: 1 })
      const entry: LogEntry = { at: new Date().toISOString(), title: logTitle(post), type: post.type, products: count }
      await r.multi().lPush(KEY_LOG, JSON.stringify(entry)).lTrim(KEY_LOG, 0, 99).exec()
    } catch (e) {
      ;(report.failed ??= []).push(`${post.rubric?.key ?? "mixed"}: ${(e as Error).message}`)
    }
    // Telegram allows about 20 messages a minute to one channel; an album counts per photo.
    await new Promise((res) => setTimeout(res, 3000))
  }

  if (sent.length) report.subscribers = await deliverToSubscribers(sent, deadline)
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
 * Sends each subscriber one message with the day's posts in their rubrics.
 * People who blocked the bot are dropped. Stops at `deadline` (the function's
 * time limit); whoever is left gets the next day's message.
 */
async function deliverToSubscribers(
  sent: { post: Post; fileIds: string[] }[],
  deadline: number,
): Promise<NonNullable<PublishReport["subscribers"]>> {
  const subscribers = await readSubscribers()
  const result = { sent: 0, removed: 0, failed: 0, unfinished: false }
  // The same categories make the same message: its picture is made once, then sent by file id.
  const pictureOf = new Map<string, string>()
  for (const [chatId, rubrics] of subscribers) {
    if (Date.now() > deadline) {
      result.unfinished = true
      break
    }
    const theirs = sent.filter(({ post }) => postRubrics(post).some((r) => rubrics.includes(r.key)))
    const digest = renderDigest(
      theirs.map((s) => s.post),
      rubrics,
    )
    if (!digest) continue
    const key = [...rubrics].sort().join(",")
    const picture = pictureOf.get(key)
    if (picture) digest.photos = [picture]
    try {
      const { fileIds } = await sendPost(chatId, digest)
      if (!picture && fileIds.length === 1) pictureOf.set(key, fileIds[0])
      result.sent++
    } catch (e) {
      if (e instanceof TelegramError && (e.code === 403 || /chat not found/i.test(e.description))) {
        await removeSubscriber(chatId)
        result.removed++
      } else {
        result.failed++
        console.warn("[telegram] subscriber", chatId, (e as Error).message)
      }
    }
    // Well under Telegram's 30 messages a second.
    await new Promise((res) => setTimeout(res, 50))
  }
  return result
}
