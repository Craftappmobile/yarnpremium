import { type NextRequest, NextResponse } from "next/server"
import { TELEGRAM_URL } from "@/lib/site"
import { inviteLink, isInvitePlace } from "@/lib/telegram-invites"
import { countTelegram } from "@/lib/telegram-stats"

// A «Підписатися» button on the site: counts the click and opens the channel
// by that place's own invite link (lib/telegram-invites.ts).
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ place: string }> }) {
  const { place } = await params
  if (!isInvitePlace(place)) return NextResponse.redirect(TELEGRAM_URL, 302)
  if (!/bot|crawl|spider|preview/i.test(req.headers.get("user-agent") ?? "")) await countTelegram({ [`clicks:p:${place}`]: 1 })
  return NextResponse.redirect(await inviteLink(place), 302)
}
