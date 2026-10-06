import { type NextRequest, NextResponse } from "next/server"
import { keycrmConfigured } from "@/lib/keycrm"
import { syncPurchases } from "@/lib/keycrm-purchase"
import { redisConfigured } from "@/lib/redis"

// Purchases paid in KeyCRM outside the site (Direct, Facebook, phone) → Meta,
// once per order (lib/keycrm-purchase.ts). Run by Vercel Cron (vercel.json)
// every half hour; each run rereads the last days, so a missed run is caught up
// by the next one.
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
  try {
    const report = await syncPurchases()
    console.log("[purchases]", JSON.stringify(report))
    return NextResponse.json(report)
  } catch (e) {
    console.error("[purchases]", (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
