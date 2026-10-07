// Daily counters for judging whether the shopping assistant pays off: how much
// it is used, what it costs, and how many orders it took part in.
//
// Redis key: assistant:stats:<YYYY-MM-DD>  hash  (Kyiv calendar day, kept 400 days)
//   conversations, messages, refusals, errors, limited, products_shown
//   tokens:<model>:input|output|cache_write|cache_read
//   orders, revenue                              every order placed on the site
//   orders_assisted, revenue_assisted            orders whose buyer wrote to the assistant
//   revenue_from_cards                           order lines added from the assistant's product cards
//   orders_add_on, revenue_add_on, discount_add_on   add-ons placed on the confirmation page (ADD_ON):
//                                                how many, what they brought, what their discount gave away
//                                                (not in orders/revenue, which count checkouts)
//   video_pages, video_<review|sample>_<started|completed>   visitors (once a day each) who opened a
//                                                product page with a video / started / finished a video
//   orders_video_page, orders_video_<review|sample>_completed, revenue_video_sample_completed
//                                                orders of buyers who did so in the past week
//
// Redis key: assistant:orders  list, newest first (the last MAX_ASSISTED_ORDERS, kept 400 days)
//   what each order of a buyer who wrote to the assistant consisted of (AssistedOrder),
//   so the statistics page can show what was sold; no names or contacts.
//
// Only the live site counts (preview deployments share Redis). Writing a
// counter never fails the request it is counting.

import { timingSafeEqual } from "node:crypto"
import { redis } from "@/lib/redis"

const KEY = (day: string) => `assistant:stats:${day}`
const KEEP = 400 * 86400

/** USD per million tokens. Writing to the 5-minute cache costs 1.25× input. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
}

const kyivDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(d)

/** Adds to the given counters of today. */
export async function countStats(add: Record<string, number>): Promise<void> {
  const entries = Object.entries(add).filter(([, n]) => n)
  if (entries.length === 0 || process.env.VERCEL_ENV !== "production") return
  try {
    const key = KEY(kyivDay(new Date()))
    const m = (await redis()).multi()
    // Float increments throughout: an integer one fails on a field already holding a fraction (revenue).
    for (const [field, n] of entries) m.hIncrByFloat(key, field, n)
    m.expire(key, KEEP)
    await m.exec()
  } catch (e) {
    console.error("[assistant stats]", (e as Error).message)
  }
}

const ORDERS_KEY = "assistant:orders"
const MAX_ASSISTED_ORDERS = 1000

/** An order whose buyer wrote to the assistant during the week before it. */
export interface AssistedOrder {
  /** When it was placed (ISO). */
  at: string
  /** KeyCRM order id. */
  number?: number
  total: number
  /** Messages the buyer sent to the assistant before ordering. */
  messages: number
  items: {
    sku: string
    name: string
    quantity: number
    unit: string
    total: number
    /** Added to the cart from one of the assistant's product cards. */
    fromCard: boolean
  }[]
}

/** Keeps what an assisted order consisted of. Never fails the order. */
export async function recordAssistedOrder(order: AssistedOrder): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") return
  try {
    const m = (await redis()).multi()
    m.lPush(ORDERS_KEY, JSON.stringify(order))
    m.lTrim(ORDERS_KEY, 0, MAX_ASSISTED_ORDERS - 1)
    m.expire(ORDERS_KEY, KEEP)
    await m.exec()
  } catch (e) {
    console.error("[assistant stats] order not recorded:", (e as Error).message)
  }
}

/** Assisted orders of the last `days` days (Kyiv calendar days, as the counters), newest first. */
export async function readAssistedOrders(days: number): Promise<AssistedOrder[]> {
  const raw = await (await redis()).lRange(ORDERS_KEY, 0, MAX_ASSISTED_ORDERS - 1)
  const first = kyivDay(new Date(Date.now() - (days - 1) * 86400_000))
  return raw.flatMap((r) => {
    try {
      const o = JSON.parse(r) as AssistedOrder
      return kyivDay(new Date(o.at)) >= first ? [o] : []
    } catch {
      return []
    }
  })
}

/** Products bought after a chat, most revenue first: how often, how much, and how much of it from the cards. */
export function soldProducts(orders: AssistedOrder[]) {
  const bySku = new Map<string, { sku: string; name: string; unit: string; orders: number; quantity: number; revenue: number; fromCard: number }>()
  for (const o of orders) {
    for (const i of o.items) {
      const p = bySku.get(i.sku) ?? { sku: i.sku, name: i.name, unit: i.unit, orders: 0, quantity: 0, revenue: 0, fromCard: 0 }
      p.orders += 1
      p.quantity += i.quantity
      p.revenue = round(p.revenue + i.total)
      if (i.fromCard) p.fromCard += 1
      bySku.set(i.sku, p)
    }
  }
  return [...bySku.values()].sort((a, b) => b.revenue - a.revenue)
}

/** Token counts of one model response, as counters. */
export function usageCounters(model: string, usage: {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}): Record<string, number> {
  return {
    [`tokens:${model}:input`]: usage.input_tokens,
    [`tokens:${model}:output`]: usage.output_tokens,
    [`tokens:${model}:cache_write`]: usage.cache_creation_input_tokens ?? 0,
    [`tokens:${model}:cache_read`]: usage.cache_read_input_tokens ?? 0,
  }
}

export interface DayStats {
  day: string
  conversations: number
  messages: number
  refusals: number
  errors: number
  limited: number
  productsShown: number
  orders: number
  revenue: number
  ordersAssisted: number
  revenueAssisted: number
  revenueFromCards: number
  video: {
    pages: number
    reviewStarted: number
    reviewCompleted: number
    sampleStarted: number
    sampleCompleted: number
    ordersPage: number
    ordersReviewCompleted: number
    ordersSampleCompleted: number
    revenueSampleCompleted: number
  }
  addOn: { orders: number; revenue: number; discount: number }
  /** Model spend in USD; null when a model without a known price ran. */
  costUsd: number | null
  tokens: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }>
}

function toDay(day: string, h: Record<string, string>): DayStats {
  const n = (f: string) => Number(h[f] ?? 0)
  const tokens: DayStats["tokens"] = {}
  for (const [field, value] of Object.entries(h)) {
    const m = /^tokens:(.+):(input|output|cache_write|cache_read)$/.exec(field)
    if (!m) continue
    const t = (tokens[m[1]] ??= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })
    t[m[2] === "cache_write" ? "cacheWrite" : m[2] === "cache_read" ? "cacheRead" : (m[2] as "input" | "output")] = Number(value)
  }
  let costUsd: number | null = 0
  for (const [model, t] of Object.entries(tokens)) {
    const p = PRICES[model]
    if (!p) {
      costUsd = null
      break
    }
    costUsd += (t.input * p.input + t.cacheWrite * p.input * 1.25 + t.cacheRead * p.cacheRead + t.output * p.output) / 1e6
  }
  return {
    day,
    conversations: n("conversations"),
    messages: n("messages"),
    refusals: n("refusals"),
    errors: n("errors"),
    limited: n("limited"),
    productsShown: n("products_shown"),
    orders: n("orders"),
    revenue: n("revenue"),
    ordersAssisted: n("orders_assisted"),
    revenueAssisted: n("revenue_assisted"),
    revenueFromCards: n("revenue_from_cards"),
    video: {
      pages: n("video_pages"),
      reviewStarted: n("video_review_started"),
      reviewCompleted: n("video_review_completed"),
      sampleStarted: n("video_sample_started"),
      sampleCompleted: n("video_sample_completed"),
      ordersPage: n("orders_video_page"),
      ordersReviewCompleted: n("orders_video_review_completed"),
      ordersSampleCompleted: n("orders_video_sample_completed"),
      revenueSampleCompleted: n("revenue_video_sample_completed"),
    },
    addOn: { orders: n("orders_add_on"), revenue: n("revenue_add_on"), discount: n("discount_add_on") },
    costUsd: costUsd === null ? null : Math.round(costUsd * 10000) / 10000,
    tokens,
  }
}

/** The last `days` days, newest first. */
export async function readStats(days: number): Promise<DayStats[]> {
  const r = await redis()
  const now = Date.now()
  const list = Array.from({ length: days }, (_, i) => kyivDay(new Date(now - i * 86400_000)))
  const hashes = await Promise.all(list.map((d) => r.hGetAll(KEY(d))))
  return list.map((d, i) => toDay(d, hashes[i] as Record<string, string>))
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits
const ratio = (a: number, b: number, digits = 2) => (b > 0 ? round(a / b, digits) : null)

/** Totals of a period and the figures worked out from them. */
export function summarize(daily: DayStats[]) {
  const sum = (f: (d: DayStats) => number) => round(daily.reduce((s, d) => s + f(d), 0))
  const unpriced = daily.some((d) => d.costUsd === null)
  const conversations = sum((d) => d.conversations)
  const messages = sum((d) => d.messages)
  const costUsd = unpriced ? null : round(daily.reduce((s, d) => s + (d.costUsd ?? 0), 0), 4)
  const orders = sum((d) => d.orders)
  const revenue = sum((d) => d.revenue)
  const ordersAssisted = sum((d) => d.ordersAssisted)
  const revenueAssisted = sum((d) => d.revenueAssisted)
  return {
    conversations,
    messages,
    messagesPerConversation: ratio(messages, conversations, 1),
    productsShown: sum((d) => d.productsShown),
    errors: sum((d) => d.errors),
    refusals: sum((d) => d.refusals),
    limited: sum((d) => d.limited),
    costUsd,
    costPerConversationUsd: costUsd === null ? null : ratio(costUsd, conversations, 4),
    orders,
    revenue,
    ordersAssisted,
    revenueAssisted,
    revenueFromCards: sum((d) => d.revenueFromCards),
    /** Share of the site's orders whose buyer wrote to the assistant. */
    assistedShare: ratio(ordersAssisted, orders),
    /** Assisted orders per conversation: a rough conversion rate of the chat. */
    ordersPerConversation: ratio(ordersAssisted, conversations, 3),
    averageOrderAssisted: ratio(revenueAssisted, ordersAssisted),
    averageOrderOther: ratio(revenue - revenueAssisted, orders - ordersAssisted),
  }
}

export type StatsSummary = ReturnType<typeof summarize>

/**
 * Do those who watch a product video to the end buy more often? Visitors are
 * counted once a day and orders within a week of watching, so the rates are
 * rough, but comparable between the groups.
 */
export function summarizeVideo(daily: DayStats[]) {
  const sum = (f: (v: DayStats["video"]) => number) => round(daily.reduce((s, d) => s + f(d.video), 0))
  const pages = sum((v) => v.pages)
  const reviewCompleted = sum((v) => v.reviewCompleted)
  const sampleCompleted = sum((v) => v.sampleCompleted)
  const ordersPage = sum((v) => v.ordersPage)
  const ordersReview = sum((v) => v.ordersReviewCompleted)
  const ordersSample = sum((v) => v.ordersSampleCompleted)
  return {
    pages,
    reviewStarted: sum((v) => v.reviewStarted),
    reviewCompleted,
    sampleStarted: sum((v) => v.sampleStarted),
    sampleCompleted,
    ordersPage,
    ordersReviewCompleted: ordersReview,
    ordersSampleCompleted: ordersSample,
    revenueSampleCompleted: sum((v) => v.revenueSampleCompleted),
    /** Orders per visitor of a video page: all of them, those who watched the sample to the end, the others. */
    conversionPage: ratio(ordersPage, pages, 4),
    conversionSample: ratio(ordersSample, sampleCompleted, 4),
    conversionNoSample: ratio(ordersPage - ordersSample, pages - sampleCompleted, 4),
    conversionReview: ratio(ordersReview, reviewCompleted, 4),
    conversionNoReview: ratio(ordersPage - ordersReview, pages - reviewCompleted, 4),
  }
}

export type VideoSummary = ReturnType<typeof summarizeVideo>

/** Add-ons on the confirmation page (ADD_ON): how often orders get one, and what it brings and costs. */
export function summarizeAddOn(daily: DayStats[]) {
  const sum = (f: (d: DayStats) => number) => round(daily.reduce((s, d) => s + f(d), 0))
  const orders = sum((d) => d.orders)
  const addOns = sum((d) => d.addOn.orders)
  const revenue = sum((d) => d.addOn.revenue)
  const discount = sum((d) => d.addOn.discount)
  return {
    orders,
    addOns,
    revenue,
    discount,
    /** Share of the site's orders that got an add-on. */
    takeRate: ratio(addOns, orders, 4),
    averageAddOn: ratio(revenue, addOns),
    /** What the add-ons raised the average order by. */
    averageOrderLift: ratio(revenue, orders),
  }
}

export type AddOnSummary = ReturnType<typeof summarizeAddOn>

/** Checks the password of the statistics pages (ASSISTANT_STATS_KEY); false while it isn't set. */
export function statsKeyValid(given: string | null | undefined): boolean {
  const expected = process.env.ASSISTANT_STATS_KEY
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
