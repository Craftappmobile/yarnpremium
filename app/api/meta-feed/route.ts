import { NextResponse } from "next/server"
import { readCatalog } from "@/lib/catalog"
import { BRAND, SITE_URL } from "@/lib/site"
import type { Product } from "@/components/shop/data"

// Product feed for the Meta catalog (Commerce Manager fetches it hourly).
// `id` is the SKU — the same id the pixel and the Conversions API send as
// content_ids — so catalog ads can match products to what people viewed and
// bought. Sold-out products stay in the feed as "out of stock": Meta keeps
// them out of ads but keeps their history, and they return once restocked.
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
] as const

/** Yarn by weight is priced per gram; ads show the price of 100 g. */
const WEIGHT_AD_GRAMS = 100

const byWeight = (p: Product) => p.priceUnit === "г"

function csvField(value: string): string {
  const v = value.replace(/\s+/g, " ").trim()
  return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function feedRow(p: Product): Record<(typeof COLUMNS)[number], string> {
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
  }
}

export async function GET() {
  const catalog = await readCatalog()
  // Before the first sync the catalog is empty; an empty feed would make Meta delete every product.
  if (catalog.length === 0) {
    return NextResponse.json({ error: "Catalog is not synced yet" }, { status: 503 })
  }
  // Meta rejects products without a photo or price.
  const rows = catalog.filter((p) => p.sku && p.image && p.price > 0).map(feedRow)
  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(","))].join("\n")
  return new NextResponse(`${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600",
    },
  })
}
