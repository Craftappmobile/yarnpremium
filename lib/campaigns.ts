// Sales that span several promotions under one name, such as Black Friday:
// their dates, and the page that lists everything they cover. Each discount
// file (lib/promo-files) is one promotion of a sale; lib/promo.ts applies it.
//
// Safe for the browser: names, addresses and dates only, no prices.

export interface Campaign {
  /** As the site, the strip and the ads name it: "Чорна п'ятниця". */
  name: string
  /** Its page, where everything on sale is listed together (app/<path>/page.tsx). */
  path: string
  /** First and last day, "YYYY-MM-DD", Kyiv time: from 00:00 of `from` to 23:59 of `to`. */
  from: string
  to: string
}

export const CAMPAIGNS: Campaign[] = [
  { name: "Чорна п'ятниця", path: "/chorna-pyatnytsia", from: "2026-11-27", to: "2026-11-29" },
]

const KYIV = "Europe/Kiev"

const kyivHour = (t: number) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: KYIV, hour: "numeric", hourCycle: "h23" }).format(t))

/** The moment a Kyiv day ("YYYY-MM-DD") starts. Kyiv is UTC+2 in winter and UTC+3 in summer. */
export function kyivDayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  const utcMidnight = Date.UTC(y, m - 1, d)
  for (const hours of [3, 2]) {
    const t = utcMidnight - hours * 3600_000
    if (kyivHour(t) === 0) return t
  }
  throw new Error(`Bad promotion day: ${day}`)
}

/** From 00:00 of `from` to the start of the day after `to`, Kyiv time; open ends are infinite. */
export function dayWindow(from?: string, to?: string): { start: number; end: number } {
  const start = from ? kyivDayStart(from) : -Infinity
  if (!to) return { start, end: Infinity }
  const [y, m, d] = to.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return { start, end: kyivDayStart(next) }
}

export const campaignWindow = (c: Campaign) => dayWindow(c.from, c.to)

export const campaignByName = (name: string) => CAMPAIGNS.find((c) => c.name === name)

/** The sale running now, if any. */
export function runningCampaign(now = Date.now()): Campaign | undefined {
  return CAMPAIGNS.find((c) => {
    const { start, end } = campaignWindow(c)
    return now >= start && now < end
  })
}

/** «27–29 листопада», «30 листопада – 2 грудня». */
export function campaignDays(c: Campaign): string {
  const { start, end } = campaignWindow(c)
  const fmt = (t: number, opts: Intl.DateTimeFormatOptions) => new Date(t).toLocaleDateString("uk-UA", { ...opts, timeZone: KYIV })
  const lastDay = end - 1
  const sameMonth = fmt(start, { month: "numeric" }) === fmt(lastDay, { month: "numeric" })
  return sameMonth
    ? `${fmt(start, { day: "numeric" })}–${fmt(lastDay, { day: "numeric", month: "long" })}`
    : `${fmt(start, { day: "numeric", month: "long" })} – ${fmt(lastDay, { day: "numeric", month: "long" })}`
}

/** How many days it lasts. */
export const campaignLength = (c: Campaign) => {
  const { start, end } = campaignWindow(c)
  return Math.round((end - start) / 86_400_000)
}
