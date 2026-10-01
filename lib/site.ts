// Site-wide constants for metadata, sitemap and robots.

export const BRAND = "SINSERITA"

/**
 * Public address of the shop. NEXT_PUBLIC_SITE_URL wins; otherwise Vercel's
 * production domain (the custom domain once one is attached, else *.vercel.app).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000")
).replace(/\/+$/, "")

/**
 * Search engines may index the shop only on its own domain. Until
 * yarnpremium.com.ua points here, the *.vercel.app address stays out of Google
 * so it doesn't compete with the old site.
 */
export const SITE_INDEXABLE = !/(\.vercel\.app|localhost)$/.test(new URL(SITE_URL).hostname)
