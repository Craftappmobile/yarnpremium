import type { ColorFamily } from "./yarn-colors"

export interface Product {
  /** Equal to `sku`: stable across catalog syncs, so saved carts and wishlists survive them. */
  id: string
  /** KeyCRM offer id (stock webhooks identify offers by it). */
  offerId: number
  name: string
  description: string
  /** Price per `priceUnit`. */
  price: number
  /** "г" for yarn sold by weight, "шт" for pieces. */
  priceUnit: string
  image: string
  images: string[]
  category: string
  /** Article / SKU — KeyCRM offer.sku; orders reference products by it. */
  sku: string
  /** Available to sell (KeyCRM stock minus reserves), in `priceUnit`. 0 = sold out. */
  stock: number
  /** Color NAME only (KeyCRM custom field «Колір»). The swatch HEX is resolved from colors.ts. */
  color: string
  /** Yarn colour worked out from the photo ("#rrggbb"); missing until the photo is analysed. */
  colorHex?: string
  /** Colour group for the filter (see yarn-colors.ts). */
  colorFamily?: ColorFamily
  /** Yarn length in meters as given in KeyCRM custom field «Метраж». 0 = unknown. */
  length: number
  /** Manufacturer (KeyCRM custom field «Виробник»). */
  brand: string
  /** Yarn model, e.g. "Patagonia" (KeyCRM custom field «Артикул»). */
  article: string
  /** Smallest quantity that can be bought and the +/− step, in `priceUnit`. */
  minQty: number
  step: number
}

export interface CartItem extends Product {
  quantity: number
  /** Grams of `quantity` taken through a leftover offer, at TAIL_DISCOUNT. */
  tail?: number
}

/** Formats a price in UAH with Ukrainian comma decimals, e.g. 2.08 -> "2,08 ₴". */
export function formatPrice(value: number): string {
  return `${value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0₴`
}

export type SortOption = "default" | "price-asc" | "price-desc" | "length-asc" | "length-desc" | "name-asc"

export const sortOptions: { value: SortOption; label: string }[] = [
  { value: "default", label: "Спочатку нові" },
  { value: "price-asc", label: "Ціна: від дешевших" },
  { value: "price-desc", label: "Ціна: від дорожчих" },
  { value: "length-asc", label: "Метраж: від меншого" },
  { value: "length-desc", label: "Метраж: від більшого" },
  { value: "name-asc", label: "Назва: А–Я" },
]

/** Returns a new sorted array; keeps the original order for "default". */
export function sortProducts<T extends Product>(items: T[], sort: SortOption): T[] {
  const copy = [...items]
  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => a.price - b.price)
    case "price-desc":
      return copy.sort((a, b) => b.price - a.price)
    case "length-asc":
      return copy.sort((a, b) => a.length - b.length)
    case "length-desc":
      return copy.sort((a, b) => b.length - a.length)
    case "name-asc":
      return copy.sort((a, b) => a.name.localeCompare(b.name, "uk"))
    default:
      return copy
  }
}

/**
 * Slider bounds that cover every product: price rounded out to 10 kopecks
 * (yarn by weight costs a few hryvnias per gram), length rounded out to the
 * 10 m slider step.
 */
export function getFilterBounds(items: Product[]): { price: [number, number]; length: [number, number] } {
  if (items.length === 0) return { price: [0, 0], length: [0, 0] }
  const prices = items.map((p) => p.price)
  const lengths = items.map((p) => p.length)
  return {
    price: [Math.floor(Math.min(...prices) * 10) / 10, Math.ceil(Math.max(...prices) * 10) / 10],
    length: [Math.floor(Math.min(...lengths) / 10) * 10, Math.ceil(Math.max(...lengths) / 10) * 10],
  }
}

type QuantityProduct = Pick<Product, "stock" | "minQty" | "step" | "priceUnit">

/** Discount on the leftover of a spool a buyer agrees to take, so none is left behind. */
export const TAIL_DISCOUNT = 0.1
/** Yarn by weight with less than this left isn't offered at all (e.g. 1 g after reserves). */
export const MIN_SELLABLE_GRAMS = 20

const byWeight = (p: Pick<Product, "priceUnit">) => p.priceUnit === "г"

/**
 * Quantities on offer. Yarn by weight: from the minimum (100 g, cashmere 50 g)
 * in steps (50 g) up to the whole spool; with less than the minimum in stock,
 * only all of it.
 */
export function quantityRules(p: QuantityProduct): { min: number; max: number; step: number } {
  if (p.stock < p.minQty) return { min: p.stock, max: p.stock, step: p.stock }
  return { min: p.minQty, max: p.stock, step: p.step }
}

/**
 * Grams that would stay on the spool, too few to sell on their own, if the
 * buyer took `quantity`: the site offers them at TAIL_DISCOUNT instead
 * (160 g in stock, 100 g wanted → 60 g). 0 when nothing like that is left.
 */
export function leftoverOffer(p: QuantityProduct, quantity: number): number {
  if (!byWeight(p)) return 0
  const left = p.stock - quantity
  return left > 0 && left < p.minQty ? left : 0
}

/**
 * Whether `quantity` can be bought, `tail` grams of it being an accepted
 * leftover offer: a step of the grid that leaves at least the minimum behind,
 * or the whole spool — as is, or as a step plus its discounted leftover.
 */
export function isValidQuantity(p: QuantityProduct, quantity: number, tail = 0): boolean {
  if (tail > 0) return quantity === p.stock && leftoverOffer(p, quantity - tail) === tail && isOnGrid(p, quantity - tail)
  if (quantity === p.stock) return quantity > 0
  return isOnGrid(p, quantity) && quantity < p.stock && leftoverOffer(p, quantity) === 0
}

function isOnGrid(p: QuantityProduct, q: number): boolean {
  return q >= p.minQty && q <= p.stock && Number.isInteger((q - p.minQty) / p.step)
}

/** Nearest amount the picker can show: on the grid (leftover offers included) or the whole spool. */
export function clampQuantity(p: QuantityProduct, quantity: number): number {
  const { min, max } = quantityRules(p)
  const q = Math.min(max, Math.max(min, quantity))
  if (q === max || isOnGrid(p, q)) return q
  return p.minQty + Math.floor((q - p.minQty) / p.step) * p.step
}

/** Nearest amount that can go into the cart without an offer: drops amounts that would leave a leftover. */
export function clampToBuyable(p: QuantityProduct, quantity: number): number {
  let q = clampQuantity(p, quantity)
  while (q < p.stock && leftoverOffer(p, q) > 0 && q - p.step >= p.minQty) q -= p.step
  return leftoverOffer(p, q) > 0 ? p.stock : q
}

/** The next amount up or down: grid steps, then the whole spool. */
export function stepQuantity(p: QuantityProduct, quantity: number, direction: 1 | -1, buyableOnly = false): number {
  const { min, max, step } = quantityRules(p)
  let q = quantity
  for (;;) {
    if (direction > 0) {
      const next = q >= max ? max : Math.min(max, min + (Math.floor((q - min) / step) + 1) * step)
      if (next === q) return q
      q = next
    } else {
      const prev = q >= max && !isOnGrid(p, max) ? min + Math.floor((max - min) / step) * step : min + (Math.ceil((q - min) / step) - 1) * step
      if (prev < min) return quantity
      q = prev
    }
    if (!buyableOnly || leftoverOffer(p, q) === 0) return q
  }
}

/** Price of `quantity`, `tail` grams of it at the leftover discount, rounded to kopecks. */
export function lineTotal(p: Pick<Product, "price">, quantity: number, tail = 0): number {
  return Math.round((p.price * quantity - p.price * tail * TAIL_DISCOUNT) * 100) / 100
}

/** "350 г" / "3 шт". */
export function formatQuantity(quantity: number, unit: string): string {
  return `${quantity.toLocaleString("uk-UA")} ${unit}`
}

/** Distinct categories with product counts, most stocked first. */
export function categoryCounts(items: Product[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of items) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "uk"))
}
