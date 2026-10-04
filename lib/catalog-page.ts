import { readCatalog } from "@/lib/catalog"
import { type CatalogSummary, summarizeCatalog } from "@/components/shop/catalog-summary"
import type { Product } from "@/components/shop/data"
import { libraryVideo } from "@/lib/bunny-stream"
import { PROMOS } from "@/lib/promo"

/**
 * What a catalog page (the home page, a category's page) is built from: the
 * products that can be bought and the summary that ships with the page.
 */
export async function catalogPageData(page: string): Promise<{ products: Product[]; summary: CatalogSummary }> {
  const catalog = await readCatalog().catch((e) => {
    console.error(`[${page}] catalog unavailable:`, (e as Error).message)
    return []
  })
  // Only what can be bought is listed.
  const products = catalog.filter((p) => p.stock > 0)
  const summary = summarizeCatalog(products)
  // A promotion's ad video, so the header shows what the ad showed.
  summary.promos = await Promise.all(
    (summary.promos ?? []).map(async (s) => {
      const ref = PROMOS.find((p) => p.category.trim().toLowerCase() === s.category.trim().toLowerCase())?.video
      const video = ref ? await libraryVideo(ref) : null
      return video ? { ...s, video } : s
    }),
  )
  return { products, summary }
}
