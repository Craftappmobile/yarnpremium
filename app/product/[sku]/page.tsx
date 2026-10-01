import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { readCatalog, readProducts } from "@/lib/catalog"
import { ProductDetail } from "@/components/shop/product-detail"

// Pages are rendered on first visit and refreshed after each catalog sync.
export const revalidate = 300

export function generateStaticParams() {
  return []
}

async function findProduct(sku: string) {
  const [product] = await readProducts([decodeURIComponent(sku)]).catch(() => [])
  return product
}

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const product = await findProduct((await params).sku)
  if (!product) return { title: "Товар не знайдено — SINSERITA" }
  return {
    title: `${product.name} — SINSERITA`,
    description: product.description || `${product.category}. ${product.color}`.trim(),
    // A sold-out page stays reachable from old links but shouldn't be indexed.
    robots: product.stock > 0 ? undefined : { index: false },
    openGraph: {
      title: product.name,
      description: product.description || undefined,
      images: product.image ? [{ url: product.image }] : undefined,
    },
  }
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const product = await findProduct((await params).sku)
  // Archived in KeyCRM (or never existed): gone for good.
  if (!product) notFound()

  const similar =
    product.stock > 0
      ? []
      : (await readCatalog().catch(() => []))
          .filter((p) => p.stock > 0 && p.category === product.category && p.sku !== product.sku)
          .slice(0, 8)
  return <ProductDetail product={product} similar={similar} />
}
