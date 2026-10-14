import { redirect } from "next/navigation"
import { readProducts } from "@/lib/catalog"
import { categoryPath } from "@/lib/category-url"
import { BuyLink } from "@/components/shop/buy-link"
import type { Product } from "@/components/shop/data"

// Shared by /buy/<sku> and /buy?i=… (lib/buy-url.ts).

/** The query to carry on when a link sends people elsewhere: the utm_* tags, so the visit still counts. */
function utmQuery(search: Record<string, string | string[] | undefined>): string {
  const utm = Object.entries(search).flatMap(([k, v]) => (k.startsWith("utm_") && typeof v === "string" ? [[k, v]] : []))
  return utm.length ? `?${new URLSearchParams(utm)}` : ""
}

export async function BuyPage({
  items,
  search,
}: {
  items: { sku: string; quantity?: number }[]
  search: Record<string, string | string[] | undefined>
}) {
  const products = await readProducts(items.map((i) => i.sku)).catch(() => [] as Product[])
  const bySku = new Map(products.map((p) => [p.sku, p]))
  const inStock = items.flatMap(({ sku, quantity }) => {
    const product = bySku.get(sku)
    return product && product.stock > 0 ? [{ product, quantity: quantity ?? product.minQty }] : []
  })
  if (inStock.length === 0) {
    // Sold out: one product's page shows similar yarn; for a set, its first product's category.
    const first = bySku.get(items[0]?.sku ?? "")
    const to = items.length === 1 && first ? `/product/${encodeURIComponent(first.sku)}` : first ? categoryPath(first.category) : "/"
    redirect(`${to}${utmQuery(search)}`)
  }
  return (
    <main id="content" className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <BuyLink items={inStock} />
    </main>
  )
}
