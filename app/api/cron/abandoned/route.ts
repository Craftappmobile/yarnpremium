import { type NextRequest, NextResponse } from "next/server"
import { processAbandoned } from "@/lib/checkout-draft"
import { keycrmConfigured } from "@/lib/keycrm"
import { redis, redisConfigured } from "@/lib/redis"

// Turns checkouts left unfinished for an hour into KeyCRM leads (lib/checkout-draft.ts).
// Run by Vercel Cron (vercel.json).
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
  const report = await processAbandoned(async (id) => (await r.exists(`order:${id}`)) > 0)
  console.log("[abandoned]", JSON.stringify(report))
  return NextResponse.json(report)
}
