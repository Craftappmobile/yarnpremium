import { NextResponse } from "next/server"
import { readCatalog } from "@/lib/catalog"
import { type ProductVideos, readAllProductVideos } from "@/lib/product-videos"
import { BRAND, SITE_URL } from "@/lib/site"
import type { Product } from "@/components/shop/data"

// Product feed for the Meta catalog (Commerce Manager fetches it hourly).
// `id` is the SKU — the same id the pixel and the Conversions API send as
// content_ids — so catalog ads can match products to what people viewed and
// bought. Sold-out products stay in the feed as "out of stock": Meta keeps
// them out of ads but keeps their history, and they return once restocked.
// Products with videos (lib/product-videos.ts) carry them too: catalog ads can
// then show the cone's video review, the same one the product page opens with.
// Only Bunny Stream's copies are listed; a product whose copy isn't ready yet
// goes without a video until it is.
export const dynamic = "force-dynamic"

const COLUMNS = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "additional_image_link",
  "brand",
  "product_type",
  "color",
  // Meta's columns for a product's videos: the link and a label of each.
  "video[0].url",
  "video[0].tag[0]",
  "video[1].url",
  "video[1].tag[0]",
] as const

/** Yarn by weight is priced per gram; ads show the price of 100 g. */
const WEIGHT_AD_GRAMS = 100

/**
 * Nothing sold by the piece costs this little: such a price is per gram with
 * the wrong unit in KeyCRM, and an ad would show it as the price of a skein.
 */
const MIN_PIECE_PRICE = 10

const byWeight = (p: Product) => p.priceUnit === "г"

function csvField(value: string): string {
  const v = value.replace(/\s+/g, " ").trim()
  return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function feedRow(p: Product, videos?: ProductVideos): Record<(typeof COLUMNS)[number], string> {
  // The review first: it shows the yarn itself, which is what an ad sells.
  const clips = [
    videos?.review && { url: videos.review.src, tag: "Відеоогляд" },
    videos?.sample && { url: videos.sample.src, tag: "Зразок" },
  ].filter((v): v is { url: string; tag: string } => Boolean(v))
  const weight = byWeight(p)
  const price = weight ? p.price * WEIGHT_AD_GRAMS : p.price
  const details = [p.category, p.color, p.length ? `${p.length} м` : "", p.brand].filter(Boolean).join(", ")
  const priceNote = weight ? `Ціна за ${WEIGHT_AD_GRAMS} г.` : ""
  return {
    id: p.sku,
    title: (weight ? `${p.name}, ${WEIGHT_AD_GRAMS} г` : p.name).slice(0, 200),
    description: [p.description || details || p.name, priceNote].filter(Boolean).join(" ").slice(0, 5000),
    availability: p.stock > 0 ? "in stock" : "out of stock",
    condition: "new",
    price: `${price.toFixed(2)} UAH`,
    link: `${SITE_URL}/product/${encodeURIComponent(p.sku)}`,
    image_link: p.image,
    additional_image_link: p.images.filter((u) => u !== p.image).slice(0, 5).join(","),
    brand: p.brand || BRAND,
    product_type: p.category,
    color: p.color,
    "video[0].url": clips[0]?.url ?? "",
    "video[0].tag[0]": clips[0]?.tag ?? "",
    "video[1].url": clips[1]?.url ?? "",
    "video[1].tag[0]": clips[1]?.tag ?? "",
  }
}

export async function GET() {
  const [catalog, videos] = await Promise.all([readCatalog(), readAllProductVideos().catch(() => new Map())])
  // Before the first sync the catalog is empty; an empty feed would make Meta delete every product.
  if (catalog.length === 0) {
    return NextResponse.json({ error: "Catalog is not synced yet" }, { status: 503 })
  }
  // Meta rejects products without a photo or price.
  const rows = catalog
    .filter((p) => p.sku && p.image && p.price > 0 && (byWeight(p) || p.price >= MIN_PIECE_PRICE))
    .map((p) => feedRow(p, videos.get(p.sku)))
  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(","))].join("\n")
  return new NextResponse(`${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600",
    },
  })
}
