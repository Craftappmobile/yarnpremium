import type { Metadata, Viewport } from "next"
import { TelegramLanding } from "@/components/shop/telegram-landing"
import { CAMPAIGNS, campaignDays, campaignWindow } from "@/lib/campaigns"
import { openGraph } from "@/lib/og"

// The landing page of the Facebook and Instagram ads that lead to the Black
// Friday Telegram channel: one button, nothing else to click away to. Out of
// search (an ad's page, not the shop's), and static: it renders at build time.

const campaign = CAMPAIGNS.find((c) => c.name === "Чорна п'ятниця")!
const title = "Чорна п'ятниця: тільки для своїх"
const description = "Таких знижок ви ще не бачили. Усі умови Чорної п'ятниці SINCERITA — у нашому Telegram-каналі."

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/tg" },
  robots: { index: false, follow: true },
  openGraph: openGraph({ url: "/tg", title, description }),
}

export const viewport: Viewport = { themeColor: "#eeeeee" }

export default function TelegramLandingPage() {
  const { end } = campaignWindow(campaign)
  return (
    <TelegramLanding
      days={campaignDays(campaign)}
      endsAt={new Date(end).toISOString()}
      // The channel had 1 203 subscribers when the page was made; round down, never up.
      subscribers="1 200+"
    />
  )
}
