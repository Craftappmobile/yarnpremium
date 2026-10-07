import { type NextRequest, NextResponse } from "next/server"
import { keycrmBackground, keycrmConfigured } from "@/lib/keycrm"
import { syncPurchases } from "@/lib/keycrm-purchase"
import { redisConfigured } from "@/lib/redis"

// Purchases paid in KeyCRM outside the site (Direct, Facebook, phone) → Meta,
// once per order (lib/keycrm-purchase.ts). Not scheduled while KeyCRM's own
// trigger sends them (see there); back in vercel.json it runs every half hour,
// and each run rereads the last days, so a missed run is caught up by the next.
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
    const { result, usage } = await keycrmBackground(syncPurchases)
    const report = { ...result, keycrm: usage }
    console.log("[purchases]", JSON.stringify(report))
    return NextResponse.json(report)
  } catch (e) {
    console.error("[purchases]", (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
