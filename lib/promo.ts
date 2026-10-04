// Promotions: a share off every product of one KeyCRM category.
//
// Two ways a promotion can stand against KeyCRM:
//   keycrm: "regular"  KeyCRM keeps the regular prices. While the promotion
//                      runs the catalog lowers each price by the percent; when
//                      it is over the prices go back by themselves.
//   keycrm: "promo"    KeyCRM already has the promotional prices (the yarn was
//                      on sale before this site). The catalog only works out
//                      the regular price from the percent, to strike through.
//                      Ending the promotion takes the strike-through away; the
//                      price stays what KeyCRM says until it is raised there.
// Either way the catalog (lib/catalog.ts) applies it on read, so the site, the
// cart, the order, the payment and KeyCRM all charge the same price.
//
// The settings below stay on the server: the shop only gets what a promotion
// does to each product (`Product.oldPrice` and `Product.promo`).

import type { Product, ProductPromo } from "@/components/shop/data"

export interface PromoConfig {
  /** As in the ads, without the percent: "Лімітована партія". The site shows "Лімітована партія −50%". */
  name: string
  /** KeyCRM category, as named there. */
  category: string
  /** What is on sale, as the strip and the header name it, when the category's name doesn't say it ("Акційний товар"). */
  title?: string
  /** The short line over the header's name; without it, the promotion's name and how long it lasts. */
  tagline?: string
  /**
   * The ad's video in Bunny Stream (its id, a Bunny link that contains it, or its title),
   * played in the header so people from the ad see what they clicked on. No
   * video, or not ready yet: the header goes without.
   */
  video?: string
  /** Percent off the regular price. */
  percent: number
  /** Which price KeyCRM holds for the category's products (see the top of this file). */
  keycrm: "regular" | "promo"
  /**
   * First and last day, "YYYY-MM-DD", Kyiv time: from 00:00 of `from` to 23:59
   * of `to`. Without `from` it runs from now; without `to`, until it is taken
   * out of this list (a limited batch: while stock lasts).
   */
  from?: string
  to?: string
}

export const PROMOS: PromoConfig[] = [
  // The merino already sold at its promotional price is filed under «Акційний товар» in KeyCRM.
  {
    name: "Лімітована партія",
    category: "Акційний товар",
    title: "Меринос 100%",
    // The strip above already carries «Лімітована партія … встигніть, поки є».
    tagline: "Італійський сток",
    percent: 50,
    keycrm: "promo",
  },
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

/** When a promotion starts, and when it is over (the start of the day after its last); open ends are infinite. */
export function promoWindow(promo: PromoConfig): { start: number; end: number } {
  const start = promo.from ? kyivDayStart(promo.from) : -Infinity
  if (!promo.to) return { start, end: Infinity }
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
 * Yarn by weight is compared by the price of 100 g, so that is rounded to
 * whole hryvnias; a piece is rounded to whole hryvnias.
 */
function roundPrice(perUnit: number, unit: string): number {
  return unit.toLowerCase() === "г" ? Math.round(perUnit * 100) / 100 : Math.round(perUnit)
}

/** Promotional price per unit from the regular one: 1,35 ₴/г −25% → 101 ₴ / 100 г → 1,01 ₴/г. */
export function promoPrice(regular: number, unit: string, percent: number): number {
  return roundPrice(regular * (1 - percent / 100), unit)
}

/** Regular price per unit from the promotional one: 1,35 ₴/г at −25% → 180 ₴ / 100 г → 1,80 ₴/г. */
export function regularPrice(promotional: number, unit: string, percent: number): number {
  return roundPrice(promotional / (1 - percent / 100), unit)
}

/** The product as the shop sells it now: with the regular price struck through while a promotion covers it. */
export function withPromo(p: Product, now = Date.now(), promos = PROMOS): Product {
  const promo = p.price > 0 ? activePromo(p.category, now, promos) : undefined
  if (!promo) return p
  const { end } = promoWindow(promo)
  const info: ProductPromo = {
    name: promoLabel(promo),
    percent: promo.percent,
    ...(promo.title ? { title: promo.title } : {}),
    ...(promo.tagline ? { tagline: promo.tagline } : {}),
    ...(Number.isFinite(end) ? { endsAt: new Date(end).toISOString() } : {}),
  }
  return promo.keycrm === "promo"
    ? { ...p, oldPrice: regularPrice(p.price, p.priceUnit, promo.percent), promo: info }
    : { ...p, oldPrice: p.price, price: promoPrice(p.price, p.priceUnit, promo.percent), promo: info }
}
