"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowRight, Check, Clock } from "lucide-react"
import { formatPriceShort } from "./data"
import type { CampaignSummary } from "./catalog-summary"
import { ProductImage } from "./product-image"
import { campaignDays, campaignLength } from "@/lib/campaigns"
import { pluralUk } from "@/lib/utils"

// A sale (lib/campaigns.ts) as the approved mock-ups show it: black, like the
// shop's buttons, with the yarn's own colours the only colour on it.

const discount = (c: Pick<CampaignSummary, "percent" | "mixed">) => `${c.mixed ? "до " : ""}−${c.percent}%`

/** «до 29 листопада включно». */
function lastDay(c: CampaignSummary): string {
  if (!c.endsAt) return ""
  const day = new Date(Date.parse(c.endsAt) - 1).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kiev" })
  return `до ${day} включно`
}

/** What is on sale, in a few words: «на «Шишибрики 700 м»», or «на 3 види пряжі». */
function onWhat(c: CampaignSummary): string {
  return c.groups.length === 1
    ? `на «${c.groups[0].title}»`
    : `на ${c.groups.length} ${pluralUk(c.groups.length, ["вид", "види", "видів"])} пряжі`
}

const items = (n: number) => `${n} ${pluralUk(n, ["товар", "товари", "товарів"])}`
const colours = (n: number) => `${n} ${pluralUk(n, ["колір", "кольори", "кольорів"])}`

/** The black strip at the top of the shop's pages while the sale runs; it leads to the sale's page. */
export function CampaignStrip({ campaign }: { campaign: CampaignSummary }) {
  return (
    <Link
      href={campaign.path}
      className="flex items-center justify-center gap-2 bg-zinc-900 px-4 py-2 text-center text-xs font-medium text-white hover:bg-zinc-800 sm:text-sm dark:bg-zinc-100 dark:text-zinc-900"
    >
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {campaign.name} {discount(campaign)}
        <span className="hidden sm:inline"> {onWhat(campaign)}</span> · {lastDay(campaign)}
      </span>
    </Link>
  )
}

/** Days, hours and minutes to the end; nothing until the page is in the browser, so the server's clock never shows. */
function useTimeLeft(endsAt: string | undefined): { d: number; h: number; m: number } | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  if (now === null || !endsAt) return null
  const left = Math.max(0, Date.parse(endsAt) - now)
  return { d: Math.floor(left / 86_400_000), h: Math.floor(left / 3_600_000) % 24, m: Math.floor(left / 60_000) % 60 }
}

const pad = (n: number) => String(n).padStart(2, "0")

function Countdown({ endsAt, compact }: { endsAt?: string; compact: boolean }) {
  const t = useTimeLeft(endsAt)
  if (!t) return null
  const parts = [
    { value: String(t.d), unit: pluralUk(t.d, ["день", "дні", "днів"]) },
    { value: pad(t.h), unit: "год" },
    { value: pad(t.m), unit: "хв" },
  ]
  if (compact) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 tabular-nums">
        <span className="mr-1 text-xs text-zinc-300">До кінця:</span>
        {parts.map((p) => (
          <span key={p.unit} className="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-base font-bold">
            {p.value} {p.unit}
          </span>
        ))}
      </p>
    )
  }
  return (
    <div>
      <p className="text-[13px] text-zinc-300">До кінця акції</p>
      <div className="mt-2 flex gap-2 tabular-nums">
        {parts.map((p) => (
          <div key={p.unit} className="min-w-16 rounded-lg bg-zinc-800 px-3.5 py-2.5 text-center">
            <div className="text-[28px] font-bold leading-tight">{p.value}</div>
            <div className="text-xs text-zinc-300">{p.unit}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The sale's banner: over the home page, with a link to the sale's page; on
 * that page, over its products (`onShow` scrolls to them). Phones get the
 * short version, so the first products still show on the first screen.
 */
export function CampaignBanner({
  campaign,
  onShow,
  heading = "h2",
}: {
  campaign: CampaignSummary
  onShow?: () => void
  heading?: "h1" | "h2"
}) {
  const Heading = heading
  const what =
    campaign.groups.length === 1
      ? `${campaign.groups[0].title} — ${colours(campaign.count)} зі знижкою.`
      : `${campaign.groups.map((g) => g.title).join(", ")} — ${items(campaign.count)} зі знижкою.`
  const days = campaignLength(campaign)
  const button = `Дивитись ${campaign.groups.length === 1 ? colours(campaign.count) : items(campaign.count)}`
  const buttonClass =
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 text-[15px] font-bold text-zinc-900 hover:bg-zinc-100"
  return (
    <section className="mb-4 flex flex-wrap items-stretch gap-8 rounded-2xl bg-zinc-900 p-5 text-white lg:mb-6 lg:p-10 dark:ring-1 dark:ring-zinc-700">
      <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-3 lg:gap-[18px]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-300 lg:text-[13px]">
          {campaignDays(campaign)}
          {days > 1 && ` · лише ${days} ${pluralUk(days, ["день", "дні", "днів"])}`}
        </p>
        <div className="flex flex-wrap items-center gap-2.5 lg:gap-4">
          <span className="rounded-lg bg-white px-2.5 py-1 text-[26px] font-extrabold leading-tight tabular-nums text-zinc-900 lg:rounded-xl lg:px-3.5 lg:py-1.5 lg:text-[40px]">
            {discount(campaign)}
          </span>
          <Heading className="text-[28px] font-extrabold leading-none tracking-tight lg:text-[44px]">{campaign.name}</Heading>
        </div>
        <p className="max-w-xl text-[15px] leading-relaxed text-zinc-200 lg:text-lg">{what} Знижка вже в цінах.</p>
        {campaign.lowest && (
          <p className="flex flex-wrap items-baseline gap-2 tabular-nums lg:gap-2.5">
            <span className="text-[13px] text-zinc-300 lg:text-[15px]">від</span>
            <span className="text-[26px] font-extrabold lg:text-[34px]">{formatPriceShort(campaign.lowest.price)}</span>
            {campaign.lowest.oldPrice && (
              <s className="text-base text-zinc-400 lg:text-xl">
                <span className="sr-only">Звичайна ціна: </span>
                {formatPriceShort(campaign.lowest.oldPrice)}
              </s>
            )}
            <span className="text-[13px] text-zinc-300 lg:text-[15px]">/ {campaign.lowest.per}</span>
          </p>
        )}
        <div className="lg:hidden">
          <Countdown endsAt={campaign.endsAt} compact />
        </div>
        <div className="hidden lg:block">
          <Countdown endsAt={campaign.endsAt} compact={false} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onShow ? (
            <button type="button" onClick={onShow} className={`${buttonClass} w-full sm:w-auto`}>
              {button}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <Link href={campaign.path} className={`${buttonClass} w-full sm:w-auto`}>
              {button}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          {campaign.endsAt && (
            <span className="hidden items-center gap-1.5 text-[13px] text-zinc-300 sm:inline-flex">
              <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
              Ціни повернуться{" "}
              {new Date(campaign.endsAt).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kiev" })} о 00:00
            </span>
          )}
        </div>
      </div>
      {campaign.images.length === 3 && (
        <div className="hidden min-w-0 flex-[1_1_340px] grid-cols-3 content-center gap-2 lg:grid" aria-hidden>
          {campaign.images.map((img, i) => (
            <div key={img.src} className={`relative aspect-[4/5] overflow-hidden rounded-lg ${i === 1 ? "" : "mt-7"}`}>
              <ProductImage src={img.src} alt="" fill sizes="160px" className="object-cover" />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
