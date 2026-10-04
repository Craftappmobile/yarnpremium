import type { Metadata } from "next"
import { redirect } from "next/navigation"
import MinimalShop from "@/components/shop/minimal-shop"
import { packCatalog } from "@/components/shop/catalog-pack"
import { FIRST_SCREEN, type CatalogSummary } from "@/components/shop/catalog-summary"
import { formatPriceShort } from "@/components/shop/data"
import { catalogPageData } from "@/lib/catalog-page"
import { pluralUk } from "@/lib/utils"
import { categoryBySlug, categoryPath, categoryTitle } from "@/lib/category-url"

// A category's own page: the catalog opened on it, rendered on the first
// visit and refreshed like the home page.
export const revalidate = 300

export function generateStaticParams() {
  return []
}

async function load(slug: string) {
  const data = await catalogPageData("category")
  const category = categoryBySlug(slug, data.summary.categories)
  return { ...data, category }
}

/** «100% меринос. 42 товари в наявності, від 135 ₴ за 100 г. Доставка по Україні.» */
function describe(category: string, summary: CatalogSummary): string {
  const group = summary.groups?.find((g) => g.category === category)
  if (!group) return `${category} в магазині пряжі SINCERITA.`
  const parts = [
    group.composition,
    `${group.count} ${pluralUk(group.count, ["товар", "товари", "товарів"])} в наявності${group.from ? `, від ${formatPriceShort(group.from.price)} за ${group.from.per}` : ""}`,
    "Доставка по Україні",
  ]
  return `${parts.filter(Boolean).join(". ")}.`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { category, summary } = await load((await params).slug)
  if (!category) return {}
  const url = categoryPath(category)
  const title = categoryTitle(category)
  const description = describe(category, summary)
  return { title, description, alternates: { canonical: url }, openGraph: { url, title, description } }
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { products, summary, category } = await load((await params).slug)
  // Nothing of it in stock, or no such category (renamed in KeyCRM): the whole catalog.
  if (!category) redirect("/")
  return (
    <main className="min-h-screen">
      <MinimalShop
        initial={packCatalog(products.filter((p) => p.category === category).slice(0, FIRST_SCREEN))}
        summary={summary}
        category={category}
        catalogVersion={Date.now().toString(36)}
      />
    </main>
  )
}
