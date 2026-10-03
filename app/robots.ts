import type { MetadataRoute } from "next"
import { SITE_INDEXABLE, SITE_URL } from "@/lib/site"

export default function robots(): MetadataRoute.Robots {
  // Before the move to the shop's own domain nothing is crawled (see lib/site.ts).
  if (!SITE_INDEXABLE) return { rules: { userAgent: "*", disallow: "/" } }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/checkout", "/wishlist"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
