// Daily figures of the Telegram channel and bot, for /admin/telegram: what the
// posts bring to the site and the shop.
//
// Redis key: tg:stats:<YYYY-MM-DD>  hash  (Kyiv calendar day, kept 400 days)
//   visits, visits:m:<medium>, visits:c:<campaign>   people who opened a link from a post or
//                                                    the bot (once per link and browser session)
//   buys                                             of them, «купити» links (app/buy)
//   orders, revenue, orders:c:<campaign>, revenue:c:<campaign>
//                                                    orders placed in a visit that began with a
//                                                    Telegram link (its utm_* tags)
//   posts                                            posts published in the channel
//   members, subscribers                             channel members and bot subscribers, as of
//                                                    the day's last check (not added up)
//
// The links' tags (lib/telegram-news.ts): utm_source=telegram, utm_medium
// channel|bot, utm_campaign the post's rubric key, «mixed», «digest» (the
// bot's message), «intro» (the pinned post) or «menu» (the bot's menu).
//
// Only the live site counts (preview deployments share Redis). Writing a
// counter never fails the request it is counting.

import { redis } from "@/lib/redis"
import { RUBRICS } from "@/lib/telegram-rubrics"

const KEY = (day: string) => `tg:stats:${day}`
const KEEP = 400 * 86400

const kyivDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(d)
const live = () => process.env.VERCEL_ENV === "production"

/** What a link's utm_medium and utm_campaign may be; anything else is counted as «other». */
export const MEDIUMS = ["channel", "bot"] as const
export const CAMPAIGNS = [...RUBRICS.map((r) => r.key), "mixed", "digest", "intro", "menu"]
export const cleanCampaign = (c: unknown) => (typeof c === "string" && CAMPAIGNS.includes(c) ? c : "other")
export const cleanMedium = (m: unknown) => (MEDIUMS as readonly string[]).includes(m as string) ? (m as string) : "other"

/** How the admin page names a campaign. */
export function campaignTitle(campaign: string): string {
  const rubric = RUBRICS.find((r) => r.key === campaign)
  if (rubric) return rubric.title
  return (
    { mixed: "Новинки дня", digest: "Повідомлення бота", intro: "Закріплений пост", menu: "Меню бота" }[campaign] ??
    "Інше"
  )
}

/** Adds to today's counters. */
export async function countTelegram(add: Record<string, number>): Promise<void> {
  const entries = Object.entries(add).filter(([, n]) => n)
  if (entries.length === 0 || !live()) return
  try {
    const key = KEY(kyivDay(new Date()))
    const m = (await redis()).multi()
    // Float increments: revenue holds fractions.
    for (const [field, n] of entries) m.hIncrByFloat(key, field, n)
    m.expire(key, KEEP)
    await m.exec()
  } catch (e) {
    console.error("[telegram stats]", (e as Error).message)
  }
}

/** Sets today's snapshot figures (members, subscribers). */
export async function setTelegram(values: Record<string, number>): Promise<void> {
  const entries = Object.entries(values).filter(([, n]) => Number.isFinite(n))
  if (entries.length === 0 || !live()) return
  try {
    const key = KEY(kyivDay(new Date()))
    await (await redis()).multi().hSet(key, Object.fromEntries(entries.map(([k, n]) => [k, String(n)]))).expire(key, KEEP).exec()
  } catch (e) {
    console.error("[telegram stats]", (e as Error).message)
  }
}

/** An order placed in a visit that began with a Telegram link. */
export async function countTelegramOrder(utm: Record<string, string>, total: number): Promise<void> {
  if (utm.utm_source !== "telegram") return
  const campaign = cleanCampaign(utm.utm_campaign)
  await countTelegram({ orders: 1, revenue: total, [`orders:c:${campaign}`]: 1, [`revenue:c:${campaign}`]: total })
}

export interface TelegramDay {
  day: string
  visits: number
  visitsChannel: number
  visitsBot: number
  buys: number
  orders: number
  revenue: number
  posts: number
  /** Null on days nobody checked. */
  members: number | null
  subscribers: number | null
  /** campaign -> its figures */
  campaigns: Record<string, { visits: number; orders: number; revenue: number }>
}

function toDay(day: string, h: Record<string, string>): TelegramDay {
  const n = (f: string) => Number(h[f] ?? 0)
  const snap = (f: string) => (h[f] === undefined ? null : Number(h[f]))
  const campaigns: TelegramDay["campaigns"] = {}
  for (const [field, value] of Object.entries(h)) {
    const m = field.match(/^(visits|orders|revenue):c:(.+)$/)
    if (!m) continue
    const c = (campaigns[m[2]] ??= { visits: 0, orders: 0, revenue: 0 })
    c[m[1] as "visits" | "orders" | "revenue"] += Number(value)
  }
  return {
    day,
    visits: n("visits"),
    visitsChannel: n("visits:m:channel"),
    visitsBot: n("visits:m:bot"),
    buys: n("buys"),
    orders: n("orders"),
    revenue: n("revenue"),
    posts: n("posts"),
    members: snap("members"),
    subscribers: snap("subscribers"),
    campaigns,
  }
}

/** The last `days` days, newest first. */
export async function readTelegramStats(days: number): Promise<TelegramDay[]> {
  const r = await redis()
  const now = Date.now()
  const list = Array.from({ length: days }, (_, i) => kyivDay(new Date(now - i * 86400_000)))
  const hashes = await Promise.all(list.map((d) => r.hGetAll(KEY(d))))
  return list.map((d, i) => toDay(d, hashes[i] as Record<string, string>))
}
