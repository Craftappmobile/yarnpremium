import type { Metadata } from "next"
import MinimalShop from "@/components/shop/minimal-shop"
import { readCatalog } from "@/lib/catalog"
import { packCatalog } from "@/components/shop/catalog-pack"

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
  // Only what can be bought is listed, packed compactly (see catalog-pack.ts);
  // the description and gallery stay on the product page.
  const products = catalog.filter((p) => p.stock > 0)
  return (
    <main className="min-h-screen">
      <MinimalShop catalog={packCatalog(products)} />
    </main>
  )
}
