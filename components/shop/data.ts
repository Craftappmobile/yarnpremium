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
  return `${value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴`
}

/**
 * Demo discount coupons. Later these can be resolved from KeyCRM instead of
 * being hardcoded. `type` is "percent" (value = %) or "fixed" (value = ₴).
 */
export interface Coupon {
  code: string
  type: "percent" | "fixed"
  value: number
  /** Optional minimum subtotal (₴) required for the coupon to apply. */
  minSubtotal?: number
}

export const coupons: Coupon[] = [
  { code: "SINSERITA10", type: "percent", value: 10 },
  { code: "YARN50", type: "fixed", value: 50, minSubtotal: 100 },
]

export type CouponResult =
  | { ok: true; coupon: Coupon; discount: number }
  | { ok: false; error: string }

/** Validates a coupon against the current subtotal and returns the discount amount (₴). */
export function applyCoupon(code: string, subtotal: number): CouponResult {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return { ok: false, error: "Введіть код купону" }
  const coupon = coupons.find((c) => c.code === normalized)
  if (!coupon) return { ok: false, error: "Купон не знайдено або недійсний" }
  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
    return { ok: false, error: `Купон діє від суми ${formatPrice(coupon.minSubtotal)}` }
  }
  const raw = coupon.type === "percent" ? (subtotal * coupon.value) / 100 : coupon.value
  // Never discount below zero.
  const discount = Math.min(raw, subtotal)
  return { ok: true, coupon, discount }
}

export type SortOption = "default" | "price-asc" | "price-desc" | "length-asc" | "length-desc" | "name-asc"

export const sortOptions: { value: SortOption; label: string }[] = [
  { value: "default", label: "За замовчуванням" },
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
 * Slider bounds that cover every product: price rounded out to whole hryvnias,
 * length rounded out to the 10 m slider step.
 */
export function getFilterBounds(items: Product[]): { price: [number, number]; length: [number, number] } {
  if (items.length === 0) return { price: [0, 0], length: [0, 0] }
  const prices = items.map((p) => p.price)
  const lengths = items.map((p) => p.length)
  return {
    price: [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))],
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
