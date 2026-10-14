import { type NextRequest, NextResponse } from "next/server"
import { statsKeyValid } from "@/lib/assistant/stats"
import { telegramConfigured } from "@/lib/telegram"
import { publishIntro } from "@/lib/telegram-news"

// The «Опублікувати зараз» button on /admin/telegram: posts and pins the «how
// to order» post (lib/telegram-news.ts) now, instead of before the next daily
// post. The page's key (ASSISTANT_STATS_KEY) comes with the form. Only the live
// site posts: previews share the bot and the channel.
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const key = String(form?.get("key") ?? "")
  if (!statsKeyValid(key)) return new NextResponse("Not found", { status: 404 })

  const back = new URL("/admin/telegram", req.nextUrl.origin)
  back.searchParams.set("key", key)
  if (!telegramConfigured() || process.env.VERCEL_ENV !== "production") {
    back.searchParams.set("intro", "error")
    back.searchParams.set("reason", "Публікує лише робочий сайт yarnpremium.com.ua")
  } else {
    try {
      const result = await publishIntro()
      back.searchParams.set("intro", result.pinned ? "pinned" : "notpinned")
      if (result.pinError) back.searchParams.set("reason", result.pinError.slice(0, 200))
    } catch (e) {
      back.searchParams.set("intro", "error")
      back.searchParams.set("reason", (e as Error).message.slice(0, 200))
    }
  }
  // 303: the browser opens the page again with GET, so a reload doesn't post twice.
  return NextResponse.redirect(back, 303)
}
