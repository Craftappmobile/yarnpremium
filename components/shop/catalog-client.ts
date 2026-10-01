"use client"

import type { Product } from "./data"

/**
 * Fetches current price and stock for saved cart/wishlist products.
 * Returns null when the catalog can't be reached, so callers keep what they have.
 */
export async function lookupProducts(skus: string[]): Promise<Map<string, Product> | null> {
  if (skus.length === 0) return new Map()
  try {
    const res = await fetch("/api/catalog/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus }),
    })
    if (!res.ok) return null
    const { products } = (await res.json()) as { products: Product[] }
    return new Map(products.map((p) => [p.sku, p]))
  } catch {
    return null
  }
}

/** Saved entries are snapshots; accept only objects that look like a product. */
export function isProductLike(value: unknown): value is Product {
  const v = value as Product
  return Boolean(v) && typeof v.sku === "string" && typeof v.price === "number" && typeof v.stock === "number"
}
