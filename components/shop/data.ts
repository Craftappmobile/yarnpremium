import type { ColorFamily } from "./yarn-colors"

export interface Product {
  /** Equal to `sku`: stable across catalog syncs, so saved carts and wishlists survive them. */
  id: string
  /** KeyCRM offer id (stock webhooks identify offers by it). */
  offerId: number
  name: string
  description: string
  /** Price per `priceUnit` — the promotional one while a promotion covers the product. */
  price: number
  /** While a promotion covers the product: its regular price per `priceUnit`, shown struck through. */
  oldPrice?: number
  /** The promotion behind `oldPrice` (lib/promo.ts). */
  promo?: ProductPromo
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
  /**
   * Yarn and sample details from KeyCRM custom fields named in lib/catalog.ts
   * (SPEC_FIELDS: склад, складання, спиці, щільність, візерунок), in that order.
   * Product page only: the listing doesn't carry them.
   */
  specs?: { name: string; value: string }[]
  /** Smallest quantity that can be bought and the +/− step, in `priceUnit`. */
  minQty: number
  step: number
}

export interface ProductPromo {
  /** As in the ads: "Лімітована партія −50%". */
  name: string
  percent: number
  /** What is on sale, where the category's name doesn't say it: "Меринос 100%". */
  title?: string
  /** The short line over the promotion's header: "Італійський сток". */
  tagline?: string
  /** When it is over (ISO): the start of the day after its last, Kyiv time. None: while stock lasts. */
  endsAt?: string
}

export interface CartItem extends Product {
  quantity: number
}

/** Formats a price in UAH with Ukrainian comma decimals, e.g. 2.08 -> "2,08 ₴". */
export function formatPrice(value: number): string {
  return `${value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0₴`
}

/** Like formatPrice, without kopecks when there are none: "405 ₴", "4,05 ₴". */
export function formatPriceShort(value: number): string {
  return formatPrice(value).replace(/,00(?=\u00a0₴)/, "")
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

type QuantityProduct = Pick<Product, "stock" | "minQty" | "step" | "priceUnit" | "promo">

/** Share of the price taken off the end of a spool that comes with a purchase so none is left behind. */
export const TAIL_DISCOUNT = 0.1

const byWeight = (p: Pick<Product, "priceUnit">) => p.priceUnit === "г"

/**
 * Quantities that can be bought. Yarn by weight: from the minimum (100 g,
 * cashmere 50 g) in steps (50 g), and a purchase may not leave less than the
 * minimum behind — then only the whole spool can be taken. A spool already
 * under the minimum isn't sold at all (the catalog shows it as sold out).
 */
export function quantityRules(p: QuantityProduct): { min: number; max: number; step: number } {
  if (p.stock < p.minQty) return { min: p.stock, max: p.stock, step: p.stock }
  // Smallest amount that leaves enough behind; if none does, the whole spool.
  const min = byWeight(p) && p.stock - p.minQty < p.minQty ? p.stock : p.minQty
  return { min, max: p.stock, step: p.step }
}

/** Whether `quantity` may be bought: the whole stock, or a step that leaves at least the minimum behind. */
export function isValidQuantity(p: QuantityProduct, quantity: number): boolean {
  if (byWeight(p) && p.stock < p.minQty) return false
  if (quantity === p.stock) return quantity > 0
  if (quantity < p.minQty || quantity > p.stock || !Number.isInteger((quantity - p.minQty) / p.step)) return false
  return !byWeight(p) || p.stock - quantity >= p.minQty
}

/** Largest valid amount short of the whole stock, or null when only all of it can be taken. */
function largestPartial(p: QuantityProduct): number | null {
  const limit = byWeight(p) ? p.stock - p.minQty : p.stock - 1
  if (limit < p.minQty) return null
  return p.minQty + Math.floor((limit - p.minQty) / p.step) * p.step
}

export function clampQuantity(p: QuantityProduct, quantity: number): number {
  const { min, max } = quantityRules(p)
  const q = Math.min(max, Math.max(min, quantity))
  if (isValidQuantity(p, q)) return q
  const partial = largestPartial(p)
  // Past the last amount that leaves enough behind: the whole spool.
  if (partial === null || q > partial) return max
  return p.minQty + Math.floor((q - p.minQty) / p.step) * p.step
}

/** The next amount up or down from `quantity`; stepping past the last partial amount takes the whole spool. */
export function stepQuantity(p: QuantityProduct, quantity: number, direction: 1 | -1): number {
  const partial = largestPartial(p)
  if (direction > 0) {
    if (partial === null || quantity >= partial) return p.stock
    return clampQuantity(p, p.minQty + (Math.floor((quantity - p.minQty) / p.step) + 1) * p.step)
  }
  if (quantity >= p.stock) return partial ?? p.stock
  return clampQuantity(p, p.minQty + (Math.ceil((quantity - p.minQty) / p.step) - 1) * p.step)
}

/**
 * Grams sold at TAIL_DISCOUNT when the whole spool is taken: what would have
 * been left behind, too little to sell, had the buyer stopped at the first
 * amount that leaves less than the minimum (160 g in stock: 100 g → 60 g;
 * 366 g: 300 g → 66 g). The same whether the buyer picked that amount or
 * «Взяти все», so the whole spool costs the same either way. None while a
 * promotion covers the product: the promotional price is the only discount.
 */
export function tailGrams(p: QuantityProduct, quantity: number): number {
  if (p.promo || !byWeight(p) || quantity !== p.stock || p.stock < p.minQty) return 0
  const firstShort = p.minQty + Math.max(0, Math.ceil((p.stock - 2 * p.minQty + 1) / p.step)) * p.step
  return Math.max(0, p.stock - firstShort)
}

/** Price of `quantity` with the tail discount, rounded to kopecks. */
export function lineTotal(p: QuantityProduct & Pick<Product, "price">, quantity: number): number {
  const total = p.price * quantity - p.price * tailGrams(p, quantity) * TAIL_DISCOUNT
  return Math.round(total * 100) / 100
}

/** What `quantity` would cost at the regular price, less what it costs now; 0 without a promotion. */
export function lineSavings(p: QuantityProduct & Pick<Product, "price" | "oldPrice">, quantity: number): number {
  if (!p.oldPrice) return 0
  return Math.max(0, Math.round((p.oldPrice * quantity - lineTotal(p, quantity)) * 100) / 100)
}

/**
 * Second-item offer: in a cart of two or more lines, the line that costs the
 * second most is sold at this share off its price on the site, a
 * promotional price included (merino at 135 ₴ / 100 г → 121,50 ₴). The
 * costliest line always stays at its price, so the cheaper purchase gets the
 * discount whichever order things were picked in.
 */
export const SECOND_ITEM = { percent: 10, name: "Друга позиція −10%" }

type PricedProduct = QuantityProduct & Pick<Product, "price" | "oldPrice">

export interface PricedLine {
  /** Price per unit for this line. */
  unitPrice: number
  total: number
  /** Regular price of the line less `total`. */
  saved: number
  /** This line has the second-item offer. */
  second: boolean
}

/** Every cart line priced, offers included, in the order given. */
export function priceLines(lines: { product: PricedProduct; quantity: number }[]): PricedLine[] {
  const usual = lines.map(({ product, quantity }) => lineTotal(product, quantity))
  // Second costliest by what it would cost otherwise; a tie goes to the line added later.
  const ranked = usual.map((total, i) => ({ total, i })).sort((a, b) => b.total - a.total || a.i - b.i)
  const secondIndex = lines.length >= 2 ? ranked[1].i : -1
  return lines.map(({ product, quantity }, i) => {
    const regular = product.oldPrice ?? product.price
    if (i === secondIndex) {
      const unitPrice = Math.round(product.price * (1 - SECOND_ITEM.percent / 100) * 10000) / 10000
      const total = Math.round(unitPrice * quantity * 100) / 100
      // Never dearer than without the offer (the spool-end discount can take off as much).
      if (total < usual[i]) {
        return { unitPrice, total, saved: Math.round((regular * quantity - total) * 100) / 100, second: true }
      }
    }
    return { unitPrice: product.price, total: usual[i], saved: lineSavings(product, quantity), second: false }
  })
}

/** How long a promotion lasts, for people: "до 19 жовтня включно", or "встигніть, поки є" without an end date. */
export function promoDeadline(promo: ProductPromo): string {
  if (!promo.endsAt) return "встигніть, поки є"
  const lastDay = new Date(Date.parse(promo.endsAt) - 1).toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Kiev",
  })
  return `до ${lastDay} включно`
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
