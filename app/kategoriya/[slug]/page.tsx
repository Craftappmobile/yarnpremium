import type { Metadata } from "next"
import { permanentRedirect, redirect } from "next/navigation"
import MinimalShop from "@/components/shop/minimal-shop"
import { packCatalog } from "@/components/shop/catalog-pack"
import { FIRST_SCREEN, type CatalogSummary } from "@/components/shop/catalog-summary"
import { formatPriceShort } from "@/components/shop/data"
import { catalogPageData } from "@/lib/catalog-page"
import { RENAMED_CATEGORIES } from "@/lib/categories"
import { categoryBySlug, categoryPath, categorySlug, categoryTitle } from "@/lib/category-url"
import { similarCategories } from "@/lib/similar-categories"
import { pluralUk } from "@/lib/utils"

// A category's own page: the catalog opened on it, rendered on the first
// visit and refreshed like the home page. A category with nothing left says
// so and shows the ones like it.
export const revalidate = 300

export function generateStaticParams() {
  return []
}

async function load(slug: string) {
  const { products, summary, soldOut: emptied } = await catalogPageData("category")
  const category = categoryBySlug(slug, summary.categories)
  /** Renamed or merged in KeyCRM: the new name, while it is there. It wins over the old one's sold-out page. */
  const renamed = Object.entries(RENAMED_CATEGORIES).find(([old]) => categorySlug(old) === slug)?.[1]
  const movedTo =
    !category && renamed && (summary.categories.includes(renamed) || emptied.includes(renamed)) ? renamed : undefined
  const soldOut = category || movedTo ? undefined : categoryBySlug(slug, emptied)
  return { products, summary, category, soldOut, movedTo }
}

/** «100% меринос. 42 товари в наявності, від 135 ₴ за 100 г. Доставка по Україні.» */
function describe(category: string, summary: CatalogSummary): string {
  const group = summary.groups?.find((g) => g.category === category)
  if (!group) return `${category} в магазині пряжі SINCERITA.`
  const parts = [
    group.composition,
    `${group.count} ${pluralUk(group.count, ["товар", "товари", "товарів"])} в наявності${
      group.from ? `, від ${formatPriceShort(group.from.price)} за ${group.from.per}` : ""
    }`,
    "Доставка по Україні",
  ]
  return `${parts.filter(Boolean).join(". ")}.`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { category, soldOut, summary } = await load((await params).slug)
  const name = category ?? soldOut
  if (!name) return {}
  const url = categoryPath(name)
  const title = category ? categoryTitle(category) : `${name}: розпродано`
  const description = category
    ? describe(category, summary)
    : `${name}: ця партія розпродана. Нові партії показуємо в Telegram-каналі SINCERITA.`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { url, title, description },
    // Nothing to buy on it: reachable from old links, but not for search results.
    ...(soldOut ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { products, summary, category, soldOut, movedTo } = await load((await params).slug)
  if (category) {
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
  if (soldOut) {
    return (
      <main className="min-h-screen">
        <MinimalShop
          initial={packCatalog([])}
          summary={summary}
          category={soldOut}
          soldOut={{
            // A promotion's category shows as it does over its products: «Меринос 100%», −50%.
            similar: similarCategories(soldOut, summary.groups ?? []).map(
              (g) => summary.promos?.find((p) => p.category === g.category) ?? g,
            ),
          }}
          catalogVersion={Date.now().toString(36)}
        />
      </main>
    )
  }
  if (movedTo) permanentRedirect(categoryPath(movedTo))
  // No such category: the whole catalog.
  redirect("/")
}
