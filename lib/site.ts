// Site-wide constants for metadata, sitemap and robots.

export const BRAND = "SINCERITA"

/** Title of the home page, and the one every page falls back to. */
export const HOME_TITLE = `${BRAND} — італійська пряжа преміум якості`

/** Shop phone, shown wherever we ask people to call. */
export const SHOP_PHONE = "+38 068 992 9059"
export const SHOP_PHONE_HREF = "+380689929059"

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

/** «KeyCRM+YanrnPremium» in Meta Business: the pixel (dataset) the shop's browser and server events go to. */
export const META_PIXEL_ID = "1629906027721243"

/** Telegram channel with new colours. */
export const TELEGRAM_URL = "https://t.me/yarnpremium"

/** Instagram: tagging it shares a finished piece, a direct message reaches a manager. */
export const INSTAGRAM_HANDLE = "yarnoncone_sincerelymerely"
export const INSTAGRAM_URL = `https://instagram.com/${INSTAGRAM_HANDLE}`
export const INSTAGRAM_DM_URL = `https://ig.me/m/${INSTAGRAM_HANDLE}`
