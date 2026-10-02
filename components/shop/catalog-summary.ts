import { type Product, categoryCounts, getFilterBounds } from "./data"

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
}

export function summarizeCatalog(products: Product[]): CatalogSummary {
  const { price, length } = getFilterBounds(products)
  return { total: products.length, priceBounds: price, lengthBounds: length, categories: categoryCounts(products).map((c) => c.name) }
}
