import { type NextRequest, NextResponse } from "next/server"
import { redisConfigured } from "@/lib/redis"
import { readStats, statsKeyValid, summarize, summarizeAddOn, summarizeVideo } from "@/lib/assistant/stats"

// Statistics of the shopping assistant over the last `days` days (default 30),
// as JSON: /api/assistant/stats?key=<ASSISTANT_STATS_KEY>&days=30
// The same figures, readable: /admin/assistant?key=…
// Without ASSISTANT_STATS_KEY set in Vercel the page doesn't exist.

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  if (!statsKeyValid(params.get("key"))) return new NextResponse("Not found", { status: 404 })
  if (!redisConfigured()) return NextResponse.json({ error: "REDIS_URL is not set" }, { status: 503 })

  const days = Math.min(Math.max(Number(params.get("days")) || 30, 1), 400)
  const daily = await readStats(days)
  return NextResponse.json({ days, summary: summarize(daily), video: summarizeVideo(daily), addOn: summarizeAddOn(daily), daily })
}
