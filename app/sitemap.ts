import type { MetadataRoute } from "next"
import { readCatalog } from "@/lib/catalog"
import { getAllPosts } from "@/lib/blog"
import { sitePages } from "@/components/shop/site-content"
import { SITE_URL } from "@/lib/site"

// Rebuilt hourly; products come from the catalog snapshot.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = (await readCatalog().catch(() => [])).filter((p) => p.stock > 0)
  const posts = getAllPosts().filter((post) => !post.draft)
  return [
    { url: `${SITE_URL}/`, changeFrequency: "hourly", priority: 1 },
    ...products.map((p) => ({
      url: `${SITE_URL}/product/${encodeURIComponent(p.sku)}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.5 },
    ...posts.map((post) => ({ url: `${SITE_URL}/blog/${post.slug}`, lastModified: post.date, priority: 0.5 })),
    ...sitePages.map((page) => ({ url: `${SITE_URL}/${page.slug}`, priority: 0.3 })),
  ]
}
