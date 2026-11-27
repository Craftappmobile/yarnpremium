import type { Metadata, Viewport } from "next"
import { TelegramLanding } from "@/components/shop/telegram-landing"
import { CAMPAIGNS, campaignWindow } from "@/lib/campaigns"
import { openGraph } from "@/lib/og"

// The landing page of the Facebook and Instagram ads that lead to the Black
// Friday Telegram channel: one button, nothing else to click away to. Out of
// search (an ad's page, not the shop's), and static: it renders at build time.

const campaign = CAMPAIGNS.find((c) => c.name === "Чорна п'ятниця")!
const title = "Чорна п'ятниця Sincerita — тільки для своїх"
const description = "Вже стартувала! Лише 3 дні, і все — в закритому Telegram."

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
  return <TelegramLanding endsAt={new Date(end).toISOString()} />
}
