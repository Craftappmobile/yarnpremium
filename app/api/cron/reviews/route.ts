import { type NextRequest, NextResponse } from "next/server"
import { redisConfigured } from "@/lib/redis"
import { loadArchive } from "@/lib/reviews-archive"
import { processReviews } from "@/lib/reviews-intake"
import { telegramConfigured } from "@/lib/telegram"

// Reviews posted in the staff group's «Відгуки» topic go to the site
// (lib/reviews-intake.ts). Run by Vercel Cron every 5 minutes (vercel.json);
// most runs find nothing to do and only look at Redis.
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Vercel Cron sends CRON_SECRET as a bearer token when the variable is set.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!telegramConfigured() || !redisConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN, REDIS_URL or ANTHROPIC_API_KEY is not set" }, { status: 500 })
  }
  // The topic's history, once per version of content/reviews-archive.json.
  const archive = await loadArchive().catch((e: Error) => ({ error: e.message }))
  if (archive) console.log("[reviews] archive", JSON.stringify(archive))
  const run = await processReviews()
  if (run.messages) console.log("[reviews]", JSON.stringify(run))
  return NextResponse.json({ ...run, archive })
}
