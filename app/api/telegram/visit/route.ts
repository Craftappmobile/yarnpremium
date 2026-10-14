import { type NextRequest, NextResponse } from "next/server"
import { cleanCampaign, cleanMedium, countTelegram } from "@/lib/telegram-stats"

// Someone opened a link from the Telegram channel or bot (components/shop/utm-capture.tsx
// reports it once per link and session), for the statistics on /admin/telegram.
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return new NextResponse(null, { status: 400 })
  const medium = cleanMedium(body.medium)
  const campaign = cleanCampaign(body.campaign)
  await countTelegram({
    visits: 1,
    [`visits:m:${medium}`]: 1,
    [`visits:c:${campaign}`]: 1,
    buys: body.buy === true ? 1 : 0,
  })
  return new NextResponse(null, { status: 204 })
}
