import { type NextRequest, NextResponse } from "next/server"
import { processAbandoned } from "@/lib/checkout-draft"
import { keycrmBackground, keycrmConfigured } from "@/lib/keycrm"
import { redis, redisConfigured } from "@/lib/redis"

// Turns checkouts left unfinished for an hour into KeyCRM leads (lib/checkout-draft.ts).
// Run by Vercel Cron (vercel.json), 5 minutes after the catalog sync so the two
// don't share KeyCRM's rate limit.
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(req: NextRequest) {
  // Vercel Cron sends CRON_SECRET as a bearer token when the variable is set.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!keycrmConfigured() || !redisConfigured()) {
    return NextResponse.json({ error: "KEYCRM_API_KEY or REDIS_URL is not set" }, { status: 500 })
  }
  const r = await redis()
  // The order route keeps `order:<checkout id>` for a day after an order is placed.
  const ordered = async (id: string) => (await r.exists(`order:${id}`)) > 0
  const { result, usage } = await keycrmBackground(() => processAbandoned(ordered))
  const report = { ...result, keycrm: usage }
  console.log("[abandoned]", JSON.stringify(report))
  return NextResponse.json(report)
}
