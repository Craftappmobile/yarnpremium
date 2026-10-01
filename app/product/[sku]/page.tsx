import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { readCatalog, readProducts } from "@/lib/catalog"
import { SITE_URL } from "@/lib/site"
import { formatPrice, type Product } from "@/components/shop/data"
import { ProductDetail } from "@/components/shop/product-detail"

// Pages are rendered on first visit and refreshed after each catalog sync.
export const revalidate = 300

export function generateStaticParams() {
  return []
}

const productPath = (sku: string) => `/product/${encodeURIComponent(sku)}`

async function findProduct(sku: string) {
  const [product] = await readProducts([decodeURIComponent(sku)]).catch(() => [])
  return product
}

function productDescription(product: Product): string {
  if (product.description) return product.description.slice(0, 300)
  const parts = [product.category, product.color, product.length ? `${product.length} м` : "", product.brand]
  return `${parts.filter(Boolean).join(", ")}. ${formatPrice(product.price)} за ${product.priceUnit}.`
}

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const product = await findProduct((await params).sku)
  if (!product) return { title: "Товар не знайдено" }
  const url = productPath(product.sku)
  const description = productDescription(product)
  return {
    title: product.name,
    description,
    alternates: { canonical: url },
    // A sold-out page stays reachable from old links but shouldn't be indexed.
    robots: product.stock > 0 ? undefined : { index: false },
    openGraph: {
      title: product.name,
      description,
      url,
      images: product.image ? [{ url: product.image, alt: product.name }] : undefined,
    },
  }
}

/** schema.org Product, so search engines can show price and availability. */
function productJsonLd(product: Product) {
  const url = `${SITE_URL}${productPath(product.sku)}`
  const byWeight = product.priceUnit === "г"
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    url,
    image: product.images.length ? product.images : product.image ? [product.image] : undefined,
    description: productDescription(product),
    category: product.category || undefined,
    color: product.color || undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "UAH",
      price: product.price,
      availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      itemCondition: "https://schema.org/NewCondition",
      // Yarn is priced per gram.
      priceSpecification: byWeight
        ? {
            "@type": "UnitPriceSpecification",
            price: product.price,
            priceCurrency: "UAH",
            referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "GRM" },
          }
        : undefined,
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
  return (
    <>
      <script
        type="application/ld+json"
        // "<" is escaped so product text can't close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(product)).replace(/</g, "\\u003c") }}
      />
      <ProductDetail product={product} similar={similar} />
    </>
  )
}
