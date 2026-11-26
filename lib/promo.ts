// Promotions: a share off every product of one KeyCRM category, or off the
// products a discount file lists.
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
//                      With `price` set, every product of the category sells
//                      at that price, whatever KeyCRM holds for it.
// A discount file (lib/promo-files, from scripts/promo-import.mjs) is a
// "regular" promotion of a sale (lib/campaigns.ts) over the SKUs it lists, each
// at the price the file gives it.
// Either way the catalog (lib/catalog.ts) applies it on read, so the site, the
// cart, the order, the payment and KeyCRM all charge the same price.
//
// The settings below stay on the server: the shop only gets what a promotion
// does to each product (`Product.oldPrice` and `Product.promo`).

import type { Product, ProductPromo } from "@/components/shop/data"
import { campaignByName, dayWindow } from "@/lib/campaigns"
import { categoryPath } from "@/lib/category-url"
import { PROMO_FILES } from "@/lib/promo-files"

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
  /**
   * One promotional price for the whole category, per 100 г for yarn by weight
   * and per piece otherwise: the odd product KeyCRM prices differently sells at
   * it too, so the site shows a single price. Only with `keycrm: "promo"`.
   */
  price?: number
  /**
   * Only these products, by SKU, each at its promotional price per 100 г for
   * yarn by weight and per piece otherwise, as the discount file gives it.
   * Without it, every product of `category`. Only with `keycrm: "regular"`.
   */
  skus?: Record<string, number>
  /** With `skus`: each product's own percent, when a file gives them different ones; else `percent`. */
  skuPercents?: Record<string, number>
  /** Its products have different discounts and `percent` is the biggest: "до −17%". */
  upTo?: boolean
  /** Yarn by weight sold only as the whole spool while the promotion runs: no 100 г, 200 г. */
  wholeOnly?: boolean
  /** The sale it is part of (lib/campaigns.ts): it runs on the sale's dates and is listed on the sale's page. */
  campaign?: string
  /** Which price KeyCRM holds for the category's products (see the top of this file). */
  keycrm: "regular" | "promo"
  /**
   * First and last day, "YYYY-MM-DD", Kyiv time: from 00:00 of `from` to 23:59
   * of `to`. Without `from` it runs from now; without `to`, until it is taken
   * out of this list (a limited batch: while stock lasts). A sale's promotion
   * takes the sale's dates instead.
   */
  from?: string
  to?: string
}

/** A discount file in lib/promo-files, as scripts/promo-import.mjs writes it. */
export interface PromoFile {
  campaign: string
  /** What is on sale: "Шишибрики 700 м". */
  title: string
  /** The KeyCRM category of its products. */
  category: string
  percent: number
  /** What the prices are of: "100 г" for yarn by weight, "шт" otherwise. */
  per: string
  source: string
  checkedAt: string
  /** Per SKU: per 100 г or per piece, as `per` says; `percent` is the badge's (older files: `percent` above). */
  prices: Record<string, { regular: number; sale: number; percent?: number }>
  /** Sold only as whole spools while the sale runs. */
  wholeOnly?: boolean
}

function fromFile(f: PromoFile): PromoConfig {
  const percents = Object.fromEntries(Object.entries(f.prices).map(([sku, p]) => [sku, p.percent ?? f.percent]))
  const mixed = new Set(Object.values(percents)).size > 1
  return {
    name: f.campaign,
    category: f.category,
    title: f.title,
    percent: mixed ? Math.max(...Object.values(percents)) : f.percent,
    skus: Object.fromEntries(Object.entries(f.prices).map(([sku, p]) => [sku, p.sale])),
    ...(mixed ? { skuPercents: percents, upTo: true } : {}),
    ...(f.wholeOnly ? { wholeOnly: true } : {}),
    campaign: f.campaign,
    keycrm: "regular",
  }
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
  // KeyCRM holds the promotional 88 ₴ / 100 г for nearly all of it; −43% strikes through 154 ₴.
  {
    name: "Лімітована партія",
    category: "Напіввовна",
    price: 88,
    percent: 43,
    keycrm: "promo",
  },
  ...PROMO_FILES.map(fromFile),
]

/** When a promotion starts, and when it is over (the start of the day after its last); open ends are infinite. */
export function promoWindow(promo: PromoConfig): { start: number; end: number } {
  if (promo.campaign) {
    const c = campaignByName(promo.campaign)
    // A sale that isn't set up never starts.
    return c ? dayWindow(c.from, c.to) : { start: Infinity, end: Infinity }
  }
  return dayWindow(promo.from, promo.to)
}

export const promoLabel = (promo: PromoConfig) => `${promo.name} ${promo.upTo ? "до " : ""}−${promo.percent}%`

/** Where a promotion's products are listed: its sale's page, or its category's. */
export const promoPath = (promo: PromoConfig) =>
  (promo.campaign && campaignByName(promo.campaign)?.path) || categoryPath(promo.category)

const sameCategory = (promo: PromoConfig, category: string) =>
  promo.category.trim().toLowerCase() === category.trim().toLowerCase()

/** Whether the promotion is for this product: listed by SKU, or of its category. */
export function covers(promo: PromoConfig, p: Pick<Product, "sku" | "category">): boolean {
  return promo.skus ? Object.hasOwn(promo.skus, p.sku) : sameCategory(promo, p.category)
}

export function isRunning(promo: PromoConfig, now = Date.now()): boolean {
  const { start, end } = promoWindow(promo)
  return now >= start && now < end
}

/** The promotion running now for this product, if any. */
export function activePromo(
  p: Pick<Product, "sku" | "category">,
  now = Date.now(),
  promos = PROMOS,
): PromoConfig | undefined {
  return promos.find((promo) => covers(promo, p) && isRunning(promo, now))
}

/** The promotions running now, as one string: it changes when one starts or ends. */
export function runningPromosKey(now = Date.now(), promos = PROMOS): string {
  return promos
    .filter((p) => isRunning(p, now))
    .map((p) => `${p.title ?? p.category}: ${promoLabel(p)}`)
    .join("; ")
}

/** The promotion running now for this product, or else the next one to come. */
export function currentOrNextPromo(
  p: Pick<Product, "sku" | "category">,
  now = Date.now(),
  promos = PROMOS,
): PromoConfig | undefined {
  return promos
    .filter((promo) => covers(promo, p) && promoWindow(promo).end > now)
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

/** A price per 100 г (or per piece) as a price per unit. */
const fixedPrice = (price: number, unit: string) => (unit.toLowerCase() === "г" ? price / 100 : price)

/**
 * Regular and promotional price per unit of a product the promotion covers,
 * from KeyCRM's price (`p.price`, before any promotion is applied). Undefined
 * when a discount file's price is no discount any more: KeyCRM's price was
 * lowered below it after the file was checked, and striking through it would
 * claim a discount that isn't there.
 */
export function promoPrices(p: Product, promo: PromoConfig): { regular: number; sale: number } | undefined {
  if (promo.skus) {
    const sale = fixedPrice(promo.skus[p.sku], p.priceUnit)
    return sale > 0 && sale < p.price ? { regular: p.price, sale } : undefined
  }
  if (promo.keycrm === "promo") {
    const sale = promo.price ? fixedPrice(promo.price, p.priceUnit) : p.price
    return { regular: regularPrice(sale, p.priceUnit, promo.percent), sale }
  }
  return { regular: p.price, sale: promoPrice(p.price, p.priceUnit, promo.percent) }
}

/** The product as the shop sells it now: with the regular price struck through while a promotion covers it. */
export function withPromo(p: Product, now = Date.now(), promos = PROMOS): Product {
  const promo = p.price > 0 ? activePromo(p, now, promos) : undefined
  const prices = promo && promoPrices(p, promo)
  if (!promo || !prices) return p
  const { end } = promoWindow(promo)
  // The product's own discount, when a file gives its products different ones.
  const percent = promo.skuPercents?.[p.sku] ?? promo.percent
  const info: ProductPromo = {
    name: `${promo.name} −${percent}%`,
    percent,
    ...(promo.title ? { title: promo.title } : {}),
    ...(promo.tagline ? { tagline: promo.tagline } : {}),
    ...(promo.campaign ? { campaign: promo.campaign } : {}),
    ...(Number.isFinite(end) ? { endsAt: new Date(end).toISOString() } : {}),
  }
  // Whole spools only: the smallest purchase is all of it (components/shop/data.ts, quantityRules).
  const whole = promo.wholeOnly && p.priceUnit.toLowerCase() === "г" && p.stock > 0 ? { minQty: p.stock, step: p.stock } : {}
  return { ...p, ...whole, price: prices.sale, oldPrice: prices.regular, promo: info }
}
