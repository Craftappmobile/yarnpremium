import { type NextRequest, NextResponse } from "next/server"
import { processAbandoned } from "@/lib/checkout-draft"
import { processUnpaidCourses } from "@/lib/mk-unpaid"
import { checkRemnants } from "@/lib/remnant-alerts"
import { keycrmBackground, keycrmConfigured } from "@/lib/keycrm"
import { redis, redisConfigured } from "@/lib/redis"

// Turns checkouts left unfinished for an hour into KeyCRM leads (lib/checkout-draft.ts),
// reports master-class orders left unpaid on yarnmk.com.ua (lib/mk-unpaid.ts), and
// KeyCRM sales that leave too little yarn behind (lib/remnant-alerts.ts).
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
  // Master-class orders left unpaid on yarnmk.com.ua: reported to the staff topic (lib/mk-unpaid.ts).
  const mkUnpaid = await processUnpaidCourses().catch((e: Error) => ({ skipped: e.message }))
  // Sales of yarn by weight that break the rule: to their own staff topic (lib/remnant-alerts.ts).
  const remnants = await keycrmBackground(checkRemnants)
    .then(({ result, usage }) => ({ ...result, keycrm: usage }))
    .catch((e: Error) => ({ skipped: e.message }))
  const report = { ...result, keycrm: usage, mkUnpaid, remnants }
  console.log("[abandoned]", JSON.stringify(report))
  return NextResponse.json(report)
}
