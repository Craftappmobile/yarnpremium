import type { Metadata } from "next"
import MinimalShop from "@/components/shop/minimal-shop"
import { readCatalog } from "@/lib/catalog"
import { packCatalog } from "@/components/shop/catalog-pack"
import { FIRST_SCREEN, summarizeCatalog } from "@/components/shop/catalog-summary"
import { libraryVideo } from "@/lib/bunny-stream"
import { PROMOS } from "@/lib/promo"

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
}

// Rebuilt after every catalog sync (revalidatePath) and at least every 5 minutes.
export const revalidate = 300

export default async function Home() {
  const catalog = await readCatalog().catch((e) => {
    console.error("[home] catalog unavailable:", (e as Error).message)
    return []
  })
  // Only what can be bought is listed. The page carries the first screen of
  // products and a summary of the rest; the browser loads the full catalog
  // (/api/catalog/packed) right after the page shows.
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
  // The first screen shows the products of the promotion's block first, as the full list does.
  const promoCategory = summary.promos?.[0]?.category
  const firstScreen = promoCategory
    ? [...products.filter((p) => p.category === promoCategory), ...products.filter((p) => p.category !== promoCategory)]
    : products
  return (
    <main className="min-h-screen">
      <MinimalShop
        initial={packCatalog(firstScreen.slice(0, FIRST_SCREEN))}
        summary={summary}
        catalogVersion={Date.now().toString(36)}
      />
    </main>
  )
}
