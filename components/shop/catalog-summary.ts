import { type Product, type ProductPromo, categoryCounts, getFilterBounds } from "./data"
import { CATEGORY_NOTES } from "@/lib/categories"
import { type Campaign, campaignByName } from "@/lib/campaigns"

/** Products that come with the catalog page itself: enough for the first screen. */
export const FIRST_SCREEN = 24

/**
 * What the catalog page needs to know about the whole catalog before it has
 * loaded: the total, the filter slider bounds and the categories. Small, so it
 * ships with the page; the products themselves arrive separately.
 */
export interface CatalogSummary {
  total: number
  priceBounds: [number, number]
  lengthBounds: [number, number]
  /** Every category, most stocked first. */
  categories: string[]
  /** For the header over each category, in the same order. */
  groups?: GroupSummary[]
  /** Categories under a promotion, for the header over them and the banner on the home page. */
  promos?: PromoSummary[]
  /** The sale running now (lib/campaigns.ts), for its banner, strip and page. */
  campaign?: CampaignSummary
}

/**
 * The header over a category, worked out from the catalog itself on every
 * build: the products change every week, so nothing here is written by hand
 * but the line about a mixed category's yarn (lib/categories.ts).
 */
export interface GroupSummary {
  category: string
  /** Products in stock. */
  count: number
  /**
   * Lowest price: of 100 g when the category sells yarn by weight, else of a
   * piece; with the regular price struck through beside it under a promotion.
   */
  from?: { price: number; oldPrice?: number; per: "100 г" | "шт" }
  /** What the yarn is: the «Склад» all its products share, or the line written for it. */
  composition?: string
}

export interface PromoSummary extends GroupSummary {
  promo: ProductPromo
  /** The ad's video (lib/promo.ts), when it has one. */
  video?: { src: string; poster: string }
}

/** A sale: what its banner says. Its promotions are listed by what they cover ("Шишибрики 700 м"), not by category. */
export interface CampaignSummary extends Campaign {
  /** Products in stock. */
  count: number
  /** The biggest discount of its promotions. */
  percent: number
  /** Whether its promotions give different discounts: the banner then says «до −N%». */
  mixed: boolean
  /** Lowest price, as a category header gives it (`from` is the sale's first day). */
  lowest?: GroupSummary["from"]
  /** Its promotions, most stocked first. */
  groups: { title: string; percent: number; count: number }[]
  /** When it is over (ISO). */
  endsAt?: string
  /** A few of its products' photos, most stocked first, for the banner. */
  images: { src: string; alt: string }[]
}

/** Marked products (defects, flaws) don't set the «від» price an ad would quote. */
const MARKED = /розрив|брак|дефект|пошкодж/i

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase()

/** «Склад» from KeyCRM when every product of the category that has it says the same. */
function sharedComposition(products: Product[]): string | undefined {
  const values = products.flatMap((p) => p.specs?.find((s) => s.name === "Склад")?.value.trim() || [])
  return values.length > 0 && values.every((v) => sameText(v, values[0])) ? values[0] : undefined
}

function summarizeGroup(category: string, products: Product[]): GroupSummary {
  // Yarn by weight is compared by 100 g; a category that has none is priced by the piece.
  const byWeight = products.some((p) => p.priceUnit === "г")
  const priced = products.filter((p) => (byWeight ? p.priceUnit === "г" : true) && p.price > 0 && !MARKED.test(p.name))
  const cheapest = priced.reduce<Product | undefined>((min, p) => (!min || p.price < min.price ? p : min), undefined)
  const scale = byWeight ? 100 : 1
  const composition = CATEGORY_NOTES[category] ?? sharedComposition(products)
  return {
    category,
    count: products.length,
    ...(cheapest
      ? {
          from: {
            price: Math.round(cheapest.price * scale * 100) / 100,
            ...(cheapest.oldPrice ? { oldPrice: Math.round(cheapest.oldPrice * scale * 100) / 100 } : {}),
            per: byWeight ? "100 г" : "шт",
          },
        }
      : {}),
    ...(composition ? { composition } : {}),
  }
}

/** Every category's header, most stocked first; `products` are the ones in stock. */
export function summarizeGroups(products: Product[]): GroupSummary[] {
  const byCategory = new Map<string, Product[]>()
  for (const p of products) {
    if (p.stock <= 0) continue
    byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p])
  }
  return categoryCounts(products.filter((p) => p.stock > 0)).map(({ name }) => summarizeGroup(name, byCategory.get(name) ?? []))
}

export function summarizePromos(groups: GroupSummary[], products: Product[]): PromoSummary[] {
  return groups.flatMap((g) => {
    // A sale's promotion may cover a few products of a category: the category's header doesn't claim them all.
    const promo = products.find((p) => p.category === g.category && p.promo && !p.promo.campaign && p.stock > 0)?.promo
    return promo ? [{ ...g, promo }] : []
  })
}

/** The sale its products are on now, from the catalog: none when nothing of it is in stock. */
export function summarizeCampaign(products: Product[]): CampaignSummary | undefined {
  const onSale = products.filter((p) => p.stock > 0 && p.promo?.campaign)
  const campaign = onSale[0] && campaignByName(onSale[0].promo!.campaign!)
  if (!campaign) return undefined
  const theirs = onSale.filter((p) => p.promo!.campaign === campaign.name).sort((a, b) => b.stock - a.stock)
  const byTitle = new Map<string, Product[]>()
  for (const p of theirs) {
    const title = p.promo!.title ?? p.category
    byTitle.set(title, [...(byTitle.get(title) ?? []), p])
  }
  const groups = [...byTitle]
    .map(([title, ps]) => ({ title, percent: ps[0].promo!.percent, count: ps.length }))
    .sort((a, b) => b.count - a.count)
  const percents = new Set(groups.map((g) => g.percent))
  const { from } = summarizeGroup(campaign.name, theirs)
  return {
    ...campaign,
    count: theirs.length,
    percent: Math.max(...percents),
    mixed: percents.size > 1,
    ...(from ? { lowest: from } : {}),
    groups,
    ...(theirs[0].promo!.endsAt ? { endsAt: theirs[0].promo!.endsAt } : {}),
    images: theirs
      .filter((p) => p.image)
      .slice(0, 3)
      .map((p) => ({ src: p.image, alt: p.name })),
  }
}

export function summarizeCatalog(products: Product[]): CatalogSummary {
  const { price, length } = getFilterBounds(products)
  const groups = summarizeGroups(products)
  const campaign = summarizeCampaign(products)
  return {
    total: products.length,
    priceBounds: price,
    lengthBounds: length,
    categories: categoryCounts(products).map((c) => c.name),
    groups,
    promos: summarizePromos(groups, products),
    ...(campaign ? { campaign } : {}),
  }
}
