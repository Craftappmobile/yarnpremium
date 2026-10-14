import { type NextRequest, NextResponse } from "next/server"
import { readCatalog } from "@/lib/catalog"
import { redisConfigured } from "@/lib/redis"
import { telegramConfigured } from "@/lib/telegram"
import { botUsername, ensureWebhook } from "@/lib/telegram-bot"
import { RUBRICS, rubricOf } from "@/lib/telegram-rubrics"
import {
  POST_HOUR,
  type Post,
  introPost,
  kyivHour,
  plannedPosts,
  publishDaily,
  renderDigest,
  renderPost,
  watchCatalog,
} from "@/lib/telegram-news"

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
  let posts: Post[]
  if (sample) {
    // The newest products in stock, as if they had all come in today.
    const items = products
      .filter((p) => p.stock > 0)
      .slice(0, 12)
      .map((product, i) => ({ product, kind: i % 4 === 3 ? ("back" as const) : ("new" as const), rubric: rubricOf(product.category, product.name) }))
    posts = [{ type: "news", rubric: null, items }]
  } else posts = (await plannedPosts(products)).posts
  return {
    postHourKyiv: POST_HOUR,
    bot,
    intro: introPost(bot),
    posts: posts.map((post) => ({ rubric: post.rubric?.key ?? "mixed", type: post.type, ...renderPost(post, bot) })),
    digestForAllCategories: renderDigest(posts, RUBRICS.map((r) => r.key)),
  }
}
