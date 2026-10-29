import { notFound, permanentRedirect, redirect } from "next/navigation"
import type { Metadata } from "next"
import { readCatalog, readProducts } from "@/lib/catalog"
import { catalogImageUrl } from "@/lib/catalog-image"
import { openGraph } from "@/lib/og"
import { SITE_URL } from "@/lib/site"
import { similarProducts } from "@/lib/similar-products"
import { readProductVideos } from "@/lib/product-videos"
import { reviewsForProduct } from "@/lib/reviews"
import { fallbackSearch, matchOldProduct, rankOldProduct } from "@/lib/old-urls"
import { formatPrice, type Product } from "@/components/shop/data"
import { ProductDetail } from "@/components/shop/product-detail"
import { ProductReviews } from "@/components/shop/reviews"

// Pages are rendered on first visit and rebuilt when the product changes
// (webhook, order, catalog sync); the hourly rebuild only refreshes the
// similar products shown under it.
export const revalidate = 3600

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
    // The preview picture, 1200×630, is the product's photo on the shop's domain: ./opengraph-image.tsx.
    openGraph: openGraph({ title: product.name, description, url }, { ownImage: true }),
  }
}

/**
 * schema.org Product, so search engines can show price and availability.
 * Google lists no product without a picture ("image" is required), so a
 * product without photos gets none: the markup would only be an error in
 * Search Console. The photos are the shop's own copies (lib/catalog-image.ts):
 * KeyCRM's file storage turns crawlers away.
 */
function productJsonLd(product: Product) {
  const photos = product.images.length ? product.images : product.image ? [product.image] : []
  if (!photos.length) return null
  const url = `${SITE_URL}${productPath(product.sku)}`
  const byWeight = product.priceUnit === "г"
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    url,
    image: photos.map(catalogImageUrl),
    description: productDescription(product),
    category: product.category || undefined,
    color: product.color || undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "UAH",
      price: product.price,
      // The promotional price holds through its last day.
      priceValidUntil: product.promo?.endsAt
        ? new Date(Date.parse(product.promo.endsAt) - 1).toLocaleDateString("sv-SE", { timeZone: "Europe/Kiev" })
        : undefined,
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

  const [similar, videos, reviews] = await Promise.all([
    product.stock > 0
      ? null
      : readCatalog()
          .catch(() => [])
          .then((catalog) => similarProducts(product, catalog)),
    readProductVideos(product.sku).catch(() => null),
    reviewsForProduct(product).catch(() => null),
  ])
  const jsonLd = productJsonLd(product)
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // "<" is escaped so product text can't close the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      )}
      <ProductDetail
        product={product}
        videos={videos}
        similar={similar?.products}
        similarByColor={similar?.byColor}
        reviews={reviews && <ProductReviews reviews={reviews} sku={product.sku} />}
      />
    </>
  )
}
