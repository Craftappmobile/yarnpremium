import type { Metadata } from "next"
import MinimalShop from "@/components/shop/minimal-shop"
import { readCatalog } from "@/lib/catalog"

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
  // Only what can be bought is listed; the long description and gallery stay on
  // the product page to keep this page light.
  const products = catalog.filter((p) => p.stock > 0).map((p) => ({ ...p, description: "", images: [] }))
  return (
    <main className="min-h-screen">
      <MinimalShop products={products} />
    </main>
  )
}
