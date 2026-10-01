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

/**
 * Quantity limits for the +/− picker. When less than the minimum is left, only
 * the whole remainder can be bought.
 */
export function quantityRules(p: Pick<Product, "stock" | "minQty" | "step">): { min: number; max: number; step: number } {
  if (p.stock < p.minQty) return { min: p.stock, max: p.stock, step: p.stock }
  return { min: p.minQty, max: p.stock, step: p.step }
}

export function clampQuantity(p: Pick<Product, "stock" | "minQty" | "step">, quantity: number): number {
  const { min, max } = quantityRules(p)
  return Math.min(max, Math.max(min, quantity))
}

/**
 * Next quantity for a +/− press. Quantities sit on the grid min, min+step, …
 * plus the whole remainder ("Взяти все"); from the remainder, − goes back onto the grid.
 */
export function stepQuantity(p: Pick<Product, "stock" | "minQty" | "step">, quantity: number, direction: 1 | -1): number {
  const { min, step } = quantityRules(p)
  const steps = (quantity - min) / step
  const next = min + (direction > 0 ? Math.floor(steps) + 1 : Math.ceil(steps) - 1) * step
  return clampQuantity(p, next)
}

/** True for quantities the picker can produce: on the grid, or the whole remainder. */
export function isValidQuantity(p: Pick<Product, "stock" | "minQty" | "step">, quantity: number): boolean {
  const { min, max, step } = quantityRules(p)
  if (quantity === max) return true
  return quantity >= min && quantity <= max && Number.isInteger((quantity - min) / step)
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
