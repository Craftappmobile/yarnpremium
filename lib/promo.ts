// Promotions: a share off every product of one KeyCRM category, for a set of days.
//
// KeyCRM keeps the regular prices. While a promotion runs, the catalog
// (lib/catalog.ts) lowers the price of each product it covers and keeps the
// regular one as `oldPrice`, so the site, the cart, the order, the payment and
// KeyCRM all charge the same promotional price. When the last day is over the
// prices go back by themselves.
//
// The settings below stay on the server: the shop only gets what a promotion
// does to each product (`Product.oldPrice` and `Product.promo`).

import type { Product, ProductPromo } from "@/components/shop/data"

export interface PromoConfig {
  /** As in the ads, without the percent: "Тиждень мериносу". The site shows "Тиждень мериносу −25%". */
  name: string
  /** KeyCRM category, as named there. */
  category: string
  /** Percent off the regular price. */
  percent: number
  /** First and last day, "YYYY-MM-DD", Kyiv time: from 00:00 of `from` to 23:59 of `to`. */
  from: string
  to: string
}

export const PROMOS: PromoConfig[] = [
  // { name: "Тиждень мериносу", category: "Мериноси тонкі", percent: 25, from: "2026-10-13", to: "2026-10-19" },
]

const KYIV = "Europe/Kiev"

const kyivHour = (t: number) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: KYIV, hour: "numeric", hourCycle: "h23" }).format(t))

/** The moment a Kyiv day ("YYYY-MM-DD") starts. Kyiv is UTC+2 in winter and UTC+3 in summer. */
function kyivDayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  const utcMidnight = Date.UTC(y, m - 1, d)
  for (const hours of [3, 2]) {
    const t = utcMidnight - hours * 3600_000
    if (kyivHour(t) === 0) return t
  }
  throw new Error(`Bad promotion day: ${day}`)
}

/** When a promotion starts, and when it is over (the start of the day after its last). */
export function promoWindow(promo: PromoConfig): { start: number; end: number } {
  const start = kyivDayStart(promo.from)
  const [y, m, d] = promo.to.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return { start, end: kyivDayStart(next) }
}

export const promoLabel = (promo: PromoConfig) => `${promo.name} −${promo.percent}%`

const sameCategory = (promo: PromoConfig, category: string) =>
  promo.category.trim().toLowerCase() === category.trim().toLowerCase()

/** The promotion running now for this category, if any. */
export function activePromo(category: string, now = Date.now(), promos = PROMOS): PromoConfig | undefined {
  return promos.find((p) => {
    if (!sameCategory(p, category)) return false
    const { start, end } = promoWindow(p)
    return now >= start && now < end
  })
}

/** The promotion running now for this category, or else the next one to come. */
export function currentOrNextPromo(category: string, now = Date.now(), promos = PROMOS): PromoConfig | undefined {
  return promos
    .filter((p) => sameCategory(p, category) && promoWindow(p).end > now)
    .sort((a, b) => promoWindow(a).start - promoWindow(b).start)[0]
}

/**
 * Promotional price per unit. Yarn by weight is compared by the price of
 * 100 g, so that is rounded to whole hryvnias (1,35 ₴/г −25% → 101 ₴ / 100 г →
 * 1,01 ₴/г); a piece is rounded to whole hryvnias.
 */
export function promoPrice(regular: number, unit: string, percent: number): number {
  const factor = 1 - percent / 100
  if (unit === "г") return Math.round(regular * 100 * factor) / 100
  return Math.round(regular * factor)
}

/** The product as the shop sells it now: at the promotional price while a promotion covers it. */
export function withPromo(p: Product, now = Date.now(), promos = PROMOS): Product {
  const promo = p.price > 0 ? activePromo(p.category, now, promos) : undefined
  if (!promo) return p
  const info: ProductPromo = {
    name: promoLabel(promo),
    percent: promo.percent,
    endsAt: new Date(promoWindow(promo).end).toISOString(),
  }
  return { ...p, oldPrice: p.price, price: promoPrice(p.price, p.priceUnit, promo.percent), promo: info }
}
