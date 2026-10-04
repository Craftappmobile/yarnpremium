import { type Product, type ProductPromo, categoryCounts, getFilterBounds } from "./data"

/** Products that come with the catalog page itself: enough for the first screen. */
export const FIRST_SCREEN = 24

/**
 * What the catalog page needs to know about the whole catalog before it has
 * loaded: the total, the filter slider bounds and the categories. Small, so it
 * ships with the page; the products themselves arrive separately.
 */
export interface CatalogSummary {
  total: number
  priceBounds: [number, number]
  lengthBounds: [number, number]
  /** Every category, most stocked first. */
  categories: string[]
  /** Categories under a promotion, for the header over them and the banner on the home page. */
  promos?: PromoSummary[]
}

export interface PromoSummary {
  category: string
  promo: ProductPromo
  /** Products in stock under it. */
  count: number
  /** Lowest price of 100 g and the regular price struck through beside it (yarn by weight, not marked). */
  from?: { price: number; oldPrice: number }
  /** The ad's video (lib/promo.ts), when it has one. */
  video?: { src: string; poster: string }
}

/** Marked products (defects, flaws) don't set the «від» price an ad would quote. */
const MARKED = /розрив|брак|дефект|пошкодж/i

export function summarizePromos(products: Product[]): PromoSummary[] {
  const byCategory = new Map<string, PromoSummary>()
  for (const p of products) {
    if (!p.promo || p.stock <= 0) continue
    const entry = byCategory.get(p.category) ?? { category: p.category, promo: p.promo, count: 0 }
    entry.count++
    if (p.priceUnit === "г" && p.oldPrice && !MARKED.test(p.name) && (!entry.from || p.price * 100 < entry.from.price)) {
      entry.from = { price: p.price * 100, oldPrice: p.oldPrice * 100 }
    }
    byCategory.set(p.category, entry)
  }
  return [...byCategory.values()].sort((a, b) => b.count - a.count)
}

export function summarizeCatalog(products: Product[]): CatalogSummary {
  const { price, length } = getFilterBounds(products)
  return {
    total: products.length,
    priceBounds: price,
    lengthBounds: length,
    categories: categoryCounts(products).map((c) => c.name),
    promos: summarizePromos(products),
  }
}
