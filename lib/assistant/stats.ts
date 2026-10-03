// Daily counters for judging whether the shopping assistant pays off: how much
// it is used, what it costs, and how many orders it took part in.
//
// Redis key: assistant:stats:<YYYY-MM-DD>  hash  (Kyiv calendar day, kept 400 days)
//   conversations, messages, refusals, errors, limited, products_shown
//   tokens:<model>:input|output|cache_write|cache_read
//   orders, revenue                              every order placed on the site
//   orders_assisted, revenue_assisted            orders whose buyer wrote to the assistant
//   revenue_from_cards                           order lines added from the assistant's product cards
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

/** Checks the password of the statistics pages (ASSISTANT_STATS_KEY); false while it isn't set. */
export function statsKeyValid(given: string | null | undefined): boolean {
  const expected = process.env.ASSISTANT_STATS_KEY
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
