import { readCatalog } from "@/lib/catalog"
import { type CatalogSummary, summarizeCatalog } from "@/components/shop/catalog-summary"
import type { Product } from "@/components/shop/data"
import { libraryVideo } from "@/lib/bunny-stream"
import { PROMOS } from "@/lib/promo"

/**
 * What a catalog page (the home page, a category's page) is built from: the
 * products that can be bought and the summary that ships with the page, and
 * the categories with nothing in stock.
 */
export async function catalogPageData(
  page: string,
): Promise<{ products: Product[]; summary: CatalogSummary; soldOut: string[] }> {
  const catalog = await readCatalog().catch((e) => {
    console.error(`[${page}] catalog unavailable:`, (e as Error).message)
    return []
  })
  // Only what can be bought is listed, and only once it has a photo: managers
  // add them later, and until then the product opens by its link alone. The
  // full catalog (/api/catalog/packed), for search and filters, leaves it out too.
  const inStock = catalog.filter((p) => p.stock > 0)
  const products = inStock.filter((p) => p.image)
  const summary = summarizeCatalog(products)
  // A promotion's ad video, so the header shows what the ad showed.
  summary.promos = await Promise.all(
    (summary.promos ?? []).map(async (s) => {
      const ref = PROMOS.find((p) => p.category.trim().toLowerCase() === s.category.trim().toLowerCase())?.video
      const video = ref ? await libraryVideo(ref) : null
      return video ? { ...s, video } : s
    }),
  )
  // Categories still in KeyCRM with nothing left: their pages say so. One with
  // stock that has no photos yet isn't sold out, just not shown.
  const stocked = new Set(inStock.map((p) => p.category))
  const soldOut = [...new Set(catalog.map((p) => p.category))].filter((c) => c && !stocked.has(c))
  return { products, summary, soldOut }
}
