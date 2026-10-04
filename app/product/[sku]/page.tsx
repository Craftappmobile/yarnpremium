import { notFound, permanentRedirect, redirect } from "next/navigation"
import type { Metadata } from "next"
import { readCatalog, readProducts } from "@/lib/catalog"
import { SITE_URL } from "@/lib/site"
import { similarProducts } from "@/lib/similar-products"
import { fallbackSearch, matchOldProduct, rankOldProduct } from "@/lib/old-urls"
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

/**
 * No product with this SKU: maybe an address of the old WooCommerce shop
 * (/product/<name-slug>/). Sends it to the matching product, else to a
 * catalog search; a plain unknown SKU is "not found".
 */
async function resolveOldAddress(slug: string): Promise<never> {
  const decoded = decodeURIComponent(slug)
  const looksOld = decoded.includes("-") || /\p{Script=Cyrillic}/u.test(decoded)
  if (looksOld) {
    const catalog = await readCatalog().catch(() => [])
    const match = matchOldProduct(slug, catalog)
    if (match) {
      console.log(`[old-url] ${decoded} → ${match.sku}`)
      permanentRedirect(productPath(match.sku))
    }
    // For tuning the matching: the closest products that didn't make it.
    const { candidates, possible } = rankOldProduct(slug, catalog)
    const near = candidates.slice(0, 3).map((c) => `${c.product.sku} «${c.product.name}» ${c.score}/${possible}`)
    console.log(`[old-url] no match for ${decoded} → ${fallbackSearch(slug)}; closest: ${near.join("; ") || "none"}`)
    redirect(fallbackSearch(slug))
  }
  // Archived in KeyCRM (or never existed): gone for good.
  notFound()
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params
  const product = await findProduct(sku)
  if (!product) return resolveOldAddress(sku)

  const similar = product.stock > 0 ? null : similarProducts(product, await readCatalog().catch(() => []))
  return (
    <>
      <script
        type="application/ld+json"
        // "<" is escaped so product text can't close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(product)).replace(/</g, "\\u003c") }}
      />
      <ProductDetail product={product} similar={similar?.products} similarByColor={similar?.byColor} />
    </>
  )
}
