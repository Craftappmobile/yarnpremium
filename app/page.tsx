import type { Metadata } from "next"
import MinimalShop from "@/components/shop/minimal-shop"
import { packCatalog } from "@/components/shop/catalog-pack"
import { FIRST_SCREEN } from "@/components/shop/catalog-summary"
import { catalogPageData } from "@/lib/catalog-page"

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
}

// Rebuilt when stock or the catalog changes (webhook, order, catalog sync:
// revalidatePath) and at least every hour. Every rebuild is billed by Vercel.
export const revalidate = 3600

export default async function Home() {
  // The page carries the first screen of products and a summary of the rest;
  // the browser loads the full catalog (/api/catalog/packed) right after the page shows.
  const { products, summary } = await catalogPageData("home")
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
