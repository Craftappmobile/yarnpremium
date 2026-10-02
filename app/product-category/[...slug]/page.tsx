import { permanentRedirect, redirect } from "next/navigation"
import { readCatalog } from "@/lib/catalog"
import { matchOldCategory } from "@/lib/old-urls"

// Old WooCommerce category addresses (/product-category/<slug>/, nested ones
// too): to the catalog filtered by the matching category, else the catalog.
export const revalidate = 3600

export function generateStaticParams() {
  return []
}

export default async function OldCategoryPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const categories = [...new Set((await readCatalog().catch(() => [])).map((p) => p.category).filter(Boolean))]
  // The deepest level names the category best; the whole path is the fallback.
  const match = matchOldCategory(slug[slug.length - 1], categories) ?? matchOldCategory(slug.join("-"), categories)
  if (match) permanentRedirect(`/?category=${encodeURIComponent(match)}`)
  redirect("/")
}
