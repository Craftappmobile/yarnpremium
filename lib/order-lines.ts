// Server-only: order lines checked against the catalog and priced, shared by
// /api/orders and /api/orders/add-on.

import { ADD_ON, type PricedLine, type Product, isValidQuantity, tailGrams } from "@/components/shop/data"
import type { Order, StockChange } from "@/lib/order"

export interface RequestLine {
  sku: string
  quantity: number
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

/** The requested lines, or null when any of them is malformed. */
export function readLines(items: unknown): RequestLine[] | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return null
  const lines = items.map((i) => ({ sku: text(i?.sku, 64), quantity: Number(i?.quantity) }))
  if (lines.some((l) => !l.sku || !Number.isFinite(l.quantity) || l.quantity <= 0)) return null
  return lines
}

/** Lines that can't be bought as asked any more: sold out, withdrawn, or a quantity no longer valid. */
export function stockChanges(lines: RequestLine[], products: Map<string, Product>): StockChange[] {
  const changes: StockChange[] = []
  for (const line of lines) {
    const p = products.get(line.sku)
    if (!p || p.stock <= 0) {
      changes.push({ sku: line.sku, name: p?.name ?? line.sku, available: 0, unit: p?.priceUnit ?? "" })
    } else if (!isValidQuantity(p, line.quantity)) {
      changes.push({ sku: p.sku, name: p.name, available: p.stock, unit: p.priceUnit })
    }
  }
  return changes
}

/** Order lines from priced request lines; `addOn` lines carry the add-on discount instead of the spool-end one. */
export function toOrderItems(
  lines: RequestLine[],
  products: Map<string, Product>,
  priced: (PricedLine & { addOn?: boolean })[],
): (Order["items"][number] & { total: number })[] {
  return lines.map((l, i) => {
    const p = products.get(l.sku)!
    const line = priced[i]
    const tail = line.addOn ? 0 : tailGrams(p, l.quantity)
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      price: line.unitPrice,
      quantity: l.quantity,
      unit: p.priceUnit,
      ...(tail > 0 ? { tail } : {}),
      total: line.total,
      ...(p.image ? { image: p.image } : {}),
      ...(line.addOn
        ? { oldPrice: p.price, promo: ADD_ON.name }
        : p.promo && p.oldPrice
          ? { oldPrice: p.oldPrice, promo: p.promo.name }
          : {}),
    }
  })
}
