import type { Product } from "@/components/shop/data"
import { colorDistance } from "@/components/shop/yarn-colors"

// «Схожа пряжа в наявності» on a sold-out product's page. People often land
// there from an ad for that exact colour, so the nearest shades in stock come
// first, whatever the yarn; the same yarn type wins between equally close ones.

const LIMIT = 8
/** Colours further apart than this aren't offered as a similar shade. */
const CLOSE = 0.1
/** Head start for the sold-out product's own category, in colour distance. */
const SAME_CATEGORY = 0.02

export interface Similar {
  products: Product[]
  /** At least one was picked by colour (else it's the category alone). */
  byColor: boolean
}

export function similarProducts(product: Product, catalog: Product[]): Similar {
  // In stock and sold the same way: no needles among the yarn.
  const candidates = catalog.filter(
    (p) => p.stock > 0 && p.sku !== product.sku && p.priceUnit === product.priceUnit,
  )
  const sameCategory = (p: Product) => p.category === product.category

  /** Infinity when either colour is unknown or multicoloured: no shade to compare. */
  const distance = (p: Product) => {
    if (!product.colorHex || !p.colorHex || product.colorFamily === "multi" || p.colorFamily === "multi") return Infinity
    return colorDistance(product.colorHex, p.colorHex) ?? Infinity
  }
  // Not a subtraction: Infinity − Infinity is NaN, which breaks the sort.
  const byDistance = (a: Product, b: Product) => {
    const x = distance(a)
    const y = distance(b)
    return x === y ? 0 : x < y ? -1 : 1
  }

  let picked: Product[] = []
  if (product.colorFamily === "multi") {
    // An average colour means nothing for multicoloured yarn: other multicoloured ones, its own type first.
    picked = candidates
      .filter((p) => p.colorFamily === "multi")
      .sort((a, b) => Number(sameCategory(b)) - Number(sameCategory(a)))
      .slice(0, LIMIT)
  } else if (product.colorHex) {
    picked = candidates
      .flatMap((p) => {
        const d = distance(p)
        return d <= CLOSE ? [{ p, score: d - (sameCategory(p) ? SAME_CATEGORY : 0) }] : []
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, LIMIT)
      .map(({ p }) => p)
  }
  const byColor = picked.length > 0

  // Too few close shades (or the colour isn't known yet): the rest from the same
  // category, as before, the nearer colours first (stable sort: else newest first).
  const rest = candidates.filter((p) => sameCategory(p) && !picked.includes(p)).sort(byDistance)
  picked.push(...rest.slice(0, LIMIT - picked.length))
  return { products: picked, byColor }
}
