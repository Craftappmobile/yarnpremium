import { timingSafeEqual } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { redisConfigured } from "@/lib/redis"
import { readStats } from "@/lib/assistant/stats"

// Statistics of the shopping assistant over the last `days` days (default 30):
// /api/assistant/stats?key=<ASSISTANT_STATS_KEY>&days=30
// Without ASSISTANT_STATS_KEY set in Vercel the page doesn't exist.

export const dynamic = "force-dynamic"

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits
const ratio = (a: number, b: number, digits = 2) => (b > 0 ? round(a / b, digits) : null)

function authorized(given: string | null): boolean {
  const expected = process.env.ASSISTANT_STATS_KEY
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  if (!authorized(params.get("key"))) return new NextResponse("Not found", { status: 404 })
  if (!redisConfigured()) return NextResponse.json({ error: "REDIS_URL is not set" }, { status: 503 })

  const days = Math.min(Math.max(Number(params.get("days")) || 30, 1), 400)
  const daily = await readStats(days)
  const sum = (f: (d: (typeof daily)[number]) => number) => round(daily.reduce((s, d) => s + f(d), 0))
  const unpriced = daily.some((d) => d.costUsd === null)

  const conversations = sum((d) => d.conversations)
  const messages = sum((d) => d.messages)
  const costUsd = unpriced ? null : sum((d) => d.costUsd ?? 0)
  const orders = sum((d) => d.orders)
  const revenue = sum((d) => d.revenue)
  const ordersAssisted = sum((d) => d.ordersAssisted)
  const revenueAssisted = sum((d) => d.revenueAssisted)

  return NextResponse.json({
    days,
    summary: {
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
    },
    daily,
  })
}
