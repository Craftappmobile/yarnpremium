import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { products } from "@/components/shop/data"
import { ProductDetail } from "@/components/shop/product-detail"

// Only known SKUs render; unknown ones 404.
export const dynamicParams = false

export function generateStaticParams() {
  return products.map((p) => ({ sku: p.sku }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>
}): Promise<Metadata> {
  const { sku } = await params
  const product = products.find((p) => p.sku === sku)
  if (!product) return { title: "Товар не знайдено — SINSERITA" }
  return {
    title: `${product.name} — SINSERITA`,
    description: product.description,
    openGraph: {
      title: product.name,
      description: product.description,
      images: product.image ? [{ url: product.image }] : undefined,
    },
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>
}) {
  const { sku } = await params
  const product = products.find((p) => p.sku === sku)
  if (!product) notFound()
  return <ProductDetail product={product} />
}
