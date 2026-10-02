import type { Metadata } from "next"
import MinimalShop from "@/components/shop/minimal-shop"
import { readCatalog } from "@/lib/catalog"
import { packCatalog } from "@/components/shop/catalog-pack"
import { FIRST_SCREEN, summarizeCatalog } from "@/components/shop/catalog-summary"

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
  return (
    <main className="min-h-screen">
      <MinimalShop initial={packCatalog(products.slice(0, FIRST_SCREEN))} summary={summarizeCatalog(products)} />
    </main>
  )
}
