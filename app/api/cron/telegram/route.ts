import { type NextRequest, NextResponse } from "next/server"
import { readCatalog } from "@/lib/catalog"
import { redisConfigured } from "@/lib/redis"
import { telegramConfigured } from "@/lib/telegram"
import { botUsername, ensureWebhook } from "@/lib/telegram-bot"
import { rubricOf } from "@/lib/telegram-rubrics"
import { POST_HOUR, kyivHour, plannedPosts, publishDaily, renderPost, watchCatalog } from "@/lib/telegram-news"

// The Telegram channel (lib/telegram-news.ts): every half hour notes what's new
// in the catalog; in the hour of the daily post, posts it. Run by Vercel Cron
// (vercel.json), a few minutes after the catalog sync.
//
// Only production posts and keeps the queue: previews share its Redis. On a
// preview, opening this URL shows what the next post would say (?sample:
// the newest products, to see the format with an empty queue).
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Vercel Cron sends CRON_SECRET as a bearer token when the variable is set.
  const secret = process.env.CRON_SECRET
  const production = process.env.VERCEL_ENV === "production"
  if (production && secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!telegramConfigured() || !redisConfigured()) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN or REDIS_URL is not set" }, { status: 500 })
  }

  const started = Date.now()
  try {
    const products = await readCatalog()
    if (!production) return NextResponse.json(await preview(products, req.nextUrl.searchParams.has("sample")))

    const webhook = await ensureWebhook().catch((e: Error) => ({ error: e.message }))
    const watch = await watchCatalog(products)
    const publish = kyivHour() === POST_HOUR ? await publishDaily(products, started + 270_000) : undefined
    const report = { webhook, watch, publish }
    console.log("[telegram]", JSON.stringify(report))
    return NextResponse.json(report)
  } catch (e) {
    console.error("[telegram] failed:", (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

async function preview(products: Awaited<ReturnType<typeof readCatalog>>, sample: boolean) {
  const bot = await botUsername().catch(() => null)
  const { posts } = sample
    ? {
        posts: [
          {
            type: "news" as const,
            rubric: rubricOf(products.find((p) => p.stock > 0)?.category ?? ""),
            items: products
              .filter((p) => p.stock > 0)
              .slice(0, 6)
              .map((product, i) => ({ product, kind: i < 4 ? ("new" as const) : ("back" as const) })),
          },
        ],
      }
    : await plannedPosts(products)
  return {
    postHourKyiv: POST_HOUR,
    bot,
    posts: posts.map((post) => ({ rubric: post.rubric.key, type: post.type, ...renderPost(post, "channel", bot) })),
  }
}
