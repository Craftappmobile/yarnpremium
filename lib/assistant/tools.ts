// The shopping assistant's tools: catalog reads over the Redis snapshot, the
// yarn calculator, and product cards for the chat. Nothing here writes: the
// buyer adds to the cart and checks out themselves.

import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { type Product, clampQuantity, formatPrice, lineTotal } from "@/components/shop/data"
import { COLOR_FAMILIES, type ColorFamily } from "@/components/shop/yarn-colors"
import { readCatalog, readProducts } from "@/lib/catalog"
import type { ProductsEvent } from "@/lib/assistant/events"
import { planYarn } from "@/lib/assistant/yarn"

type Tool = Anthropic.Beta.BetaTool

const COLOR_IDS = COLOR_FAMILIES.map((f) => f.id) as [ColorFamily, ...ColorFamily[]]
const MAX_CARDS = 6

export const TOOLS: Tool[] = [
  {
    name: "catalog_overview",
    description:
      "Categories, manufacturers and colour groups of the yarn in stock, with counts. Use it to learn what the shop carries before searching by category or brand.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_products",
    description:
      "Searches the catalog. Matches words in the name, model, manufacturer, category, colour and description, and narrows by the filters given. Returns up to `limit` products, in-stock ones only unless include_sold_out is true. Prices of yarn sold by weight are given per 100 g.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for, e.g. «кашемір шовк» or «меринос зелений»." },
        category: { type: "string", description: "Category name, or part of it, as catalog_overview lists it." },
        brand: { type: "string", description: "Manufacturer, or part of the name." },
        color_family: { type: "string", enum: COLOR_IDS, description: "Colour group worked out from the photo." },
        min_meters_per_100g: { type: "number" },
        max_meters_per_100g: { type: "number" },
        max_price_per_100g: { type: "number", description: "UAH." },
        include_sold_out: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 12, description: "Default 8." },
      },
    },
  },
  {
    name: "get_product",
    description: "Everything known about one product: description, composition when given, metrage, stock, buying rules.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
    },
  },
  {
    name: "calculate_yarn",
    description:
      "How many grams of a yarn sold by weight to buy for a pattern, rounded to what the shop sells (minimum 100 g, 50 g for cashmere, then 50 g steps), with the price and whether the stock is enough. Give either pattern_meters, or pattern_grams with pattern_meters_per_100g of the yarn the pattern was written for.",
    input_schema: {
      type: "object",
      properties: {
        sku: { type: "string" },
        pattern_meters: { type: "number", description: "Total length the pattern needs, in metres." },
        pattern_grams: { type: "number", description: "Grams of the pattern's yarn." },
        pattern_meters_per_100g: { type: "number", description: "Metrage per 100 g of the pattern's yarn." },
        strands: {
          type: "integer",
          minimum: 1,
          maximum: 6,
          description: "Strands of this yarn knitted together in place of one strand of the pattern's yarn. Default 1.",
        },
        reserve_percent: { type: "number", minimum: 0, maximum: 30, description: "Default 10." },
      },
      required: ["sku"],
    },
  },
  {
    name: "show_products",
    description: `Shows product cards in the chat, each with a photo, price, stock and an «Add to cart» button for the quantity given (grams for yarn sold by weight). The buyer decides whether to add. Up to ${MAX_CARDS} products.`,
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: MAX_CARDS,
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              quantity: { type: "number", description: "Suggested quantity; the product's minimum when left out." },
            },
            required: ["sku"],
          },
        },
      },
      required: ["items"],
    },
  },
]

const SearchInput = z.object({
  query: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  color_family: z.enum(COLOR_IDS).optional(),
  min_meters_per_100g: z.number().optional(),
  max_meters_per_100g: z.number().optional(),
  max_price_per_100g: z.number().optional(),
  include_sold_out: z.boolean().optional(),
  limit: z.number().int().min(1).max(12).optional(),
})
const SkuInput = z.object({ sku: z.string().min(1).max(64) })
const CalculateInput = z.object({
  sku: z.string().min(1).max(64),
  pattern_meters: z.number().positive().max(100_000).optional(),
  pattern_grams: z.number().positive().max(20_000).optional(),
  pattern_meters_per_100g: z.number().positive().max(10_000).optional(),
  strands: z.number().int().min(1).max(6).optional(),
  reserve_percent: z.number().min(0).max(30).optional(),
})
const ShowInput = z.object({
  items: z
    .array(z.object({ sku: z.string().min(1).max(64), quantity: z.number().positive().optional() }))
    .min(1)
    .max(MAX_CARDS),
})

export interface ToolOutcome {
  content: string
  isError?: boolean
  /** Sent to the chat besides the result for the model. */
  event?: ProductsEvent
}

const byWeight = (p: Product) => p.priceUnit === "г"

function priceLabel(p: Product): string {
  return byWeight(p) ? `${formatPrice(p.price * 100)} за 100 г` : `${formatPrice(p.price)} за ${p.priceUnit}`
}

/** The fields the model needs to compare products, without the long description. */
function brief(p: Product) {
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand || undefined,
    model: p.article || undefined,
    category: p.category,
    color: p.color || undefined,
    meters_per_100g: byWeight(p) && p.length > 0 ? p.length : undefined,
    price: priceLabel(p),
    in_stock: p.stock > 0 ? `${p.stock} ${p.priceUnit}` : "немає",
  }
}

/** Lower-case words; long words are cut to a stem so Ukrainian endings still match. */
function stems(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ʼ'’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .map((w) => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w))
}

function matchScore(p: Product, terms: string[]): number {
  if (terms.length === 0) return 1
  const strong = `${p.name} ${p.article} ${p.brand} ${p.color}`.toLowerCase()
  const weak = `${p.category} ${p.description}`.toLowerCase()
  let score = 0
  for (const t of terms) {
    if (strong.includes(t)) score += 3
    else if (weak.includes(t)) score += 1
    else return 0
  }
  return score
}

const contains = (value: string, part?: string) => !part || value.toLowerCase().includes(part.toLowerCase().trim())

async function search(input: z.infer<typeof SearchInput>): Promise<ToolOutcome> {
  const terms = stems(input.query ?? "")
  const found = (await readCatalog())
    .filter((p) => input.include_sold_out || p.stock > 0)
    .filter((p) => contains(p.category, input.category) && contains(p.brand, input.brand))
    .filter((p) => !input.color_family || p.colorFamily === input.color_family)
    .filter((p) => input.min_meters_per_100g === undefined || p.length >= input.min_meters_per_100g)
    .filter((p) => input.max_meters_per_100g === undefined || (p.length > 0 && p.length <= input.max_meters_per_100g))
    .filter((p) => input.max_price_per_100g === undefined || (byWeight(p) && p.price * 100 <= input.max_price_per_100g))
    .map((p) => ({ p, score: matchScore(p, terms) }))
    .filter((r) => r.score > 0)
    // Best match first; in-stock before sold out; the catalog's newest-first order otherwise.
    .sort((a, b) => b.score - a.score || Number(b.p.stock > 0) - Number(a.p.stock > 0))
  const limit = input.limit ?? 8
  return {
    content: JSON.stringify({
      total_found: found.length,
      products: found.slice(0, limit).map((r) => brief(r.p)),
    }),
  }
}

async function overview(): Promise<ToolOutcome> {
  const inStock = (await readCatalog()).filter((p) => p.stock > 0)
  const count = (values: string[]) => {
    const m = new Map<string, number>()
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1)
    return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))
  }
  return {
    content: JSON.stringify({
      products_in_stock: inStock.length,
      categories: count(inStock.map((p) => p.category)),
      brands: count(inStock.map((p) => p.brand)),
      color_families: Object.fromEntries(
        COLOR_FAMILIES.map((f) => [f.id, { label: f.label, count: inStock.filter((p) => p.colorFamily === f.id).length }]),
      ),
    }),
  }
}

async function oneProduct(sku: string): Promise<Product | null> {
  const [p] = await readProducts([sku])
  return p ?? null
}

const notFound = (sku: string): ToolOutcome => ({ content: `Товар з артикулом ${sku} не знайдено.`, isError: true })

async function details(sku: string): Promise<ToolOutcome> {
  const p = await oneProduct(sku)
  if (!p) return notFound(sku)
  return {
    content: JSON.stringify({
      ...brief(p),
      description: p.description || undefined,
      // Composition, strands, needles, gauge, stitch of the shop's sample (from KeyCRM).
      specs: p.specs?.length ? Object.fromEntries(p.specs.map((s) => [s.name, s.value])) : undefined,
      buying: byWeight(p)
        ? `від ${p.minQty} г, далі кроком ${p.step} г; якщо після покупки лишилося б менше ${p.minQty} г, продається лише вся бобіна (на залишок знижка 10%)`
        : `від ${p.minQty} ${p.priceUnit}`,
      url: `/product/${encodeURIComponent(p.sku)}`,
    }),
  }
}

async function calculate(input: z.infer<typeof CalculateInput>): Promise<ToolOutcome> {
  const patternMeters =
    input.pattern_meters ??
    (input.pattern_grams && input.pattern_meters_per_100g
      ? (input.pattern_grams * input.pattern_meters_per_100g) / 100
      : undefined)
  if (!patternMeters) {
    return { content: "Потрібен pattern_meters або pattern_grams разом з pattern_meters_per_100g.", isError: true }
  }
  const p = await oneProduct(input.sku)
  if (!p) return notFound(input.sku)
  const strands = input.strands ?? 1
  const reservePercent = input.reserve_percent ?? 10
  const plan = planYarn(p, { patternMeters, strands, reservePercent })
  if (!plan.ok) return { content: plan.reason, isError: true }
  return {
    content: JSON.stringify({
      product: brief(p),
      assumptions: { pattern_meters: Math.round(patternMeters), strands, reserve_percent: reservePercent },
      effective_meters_per_100g: plan.effectiveMetersPer100g,
      grams_needed: plan.gramsNeeded,
      grams_to_buy: plan.gramsToBuy,
      price: formatPrice(plan.price),
      enough_in_stock: plan.enoughInStock,
      shortfall_grams: plan.shortfall || undefined,
      whole_spool: plan.wholeSpool || undefined,
    }),
  }
}

async function show(input: z.infer<typeof ShowInput>): Promise<ToolOutcome> {
  const skus = [...new Set(input.items.map((i) => i.sku))]
  const products = new Map((await readProducts(skus)).map((p) => [p.sku, p]))
  const items: { product: Product; quantity: number }[] = []
  const missing: string[] = []
  for (const sku of skus) {
    const product = products.get(sku)
    if (!product) {
      missing.push(sku)
      continue
    }
    const asked = input.items.find((i) => i.sku === sku)?.quantity ?? product.minQty
    // Up to the next amount on sale, never below what was asked for (clampQuantity alone rounds down).
    const steps = Math.max(0, Math.ceil((asked - product.minQty) / product.step))
    const quantity = product.stock > 0 ? clampQuantity(product, product.minQty + steps * product.step) : 0
    items.push({ product, quantity })
  }
  const shown = items.map(({ product: p, quantity }) =>
    p.stock > 0
      ? `${p.sku}: ${quantity} ${p.priceUnit} за ${formatPrice(lineTotal(p, quantity))}`
      : `${p.sku}: немає в наявності`,
  )
  return {
    content: [
      shown.length ? `Показано картки (покупець сам вирішує, чи додати в кошик): ${shown.join("; ")}.` : "",
      missing.length ? `Не знайдено: ${missing.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    isError: items.length === 0,
    event: items.length ? { type: "products", items } : undefined,
  }
}

/** Runs one tool call; a bad input or a failure comes back as an error result, never as a throw. */
export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
  const invalid = (e: z.ZodError) => ({ content: `Некоректні параметри: ${e.message}`, isError: true })
  try {
    switch (name) {
      case "catalog_overview":
        return await overview()
      case "search_products": {
        const parsed = SearchInput.safeParse(input)
        return parsed.success ? await search(parsed.data) : invalid(parsed.error)
      }
      case "get_product": {
        const parsed = SkuInput.safeParse(input)
        return parsed.success ? await details(parsed.data.sku) : invalid(parsed.error)
      }
      case "calculate_yarn": {
        const parsed = CalculateInput.safeParse(input)
        return parsed.success ? await calculate(parsed.data) : invalid(parsed.error)
      }
      case "show_products": {
        const parsed = ShowInput.safeParse(input)
        return parsed.success ? await show(parsed.data) : invalid(parsed.error)
      }
      default:
        return { content: `Невідомий інструмент ${name}.`, isError: true }
    }
  } catch (e) {
    console.error("[assistant] tool failed", name, e)
    return { content: "Каталог тимчасово недоступний.", isError: true }
  }
}

/** Short line for the chat while a tool runs. */
export function toolStatus(name: string): string {
  switch (name) {
    case "calculate_yarn":
      return "Рахую кількість пряжі…"
    case "show_products":
      return "Готую картки товарів…"
    default:
      return "Шукаю в каталозі…"
  }
}
