/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Styles go into the page itself instead of separate files the browser has
    // to fetch before it can show anything (one round trip less on mobile).
    inlineCss: true,
  },
  // Product photos from KeyCRM are resized and converted to WebP by Vercel
  // (billed per transformation, so the size list is short and results are
  // cached for a month — KeyCRM gives every upload a new file name).
  images: {
    remotePatterns: [{ protocol: "https", hostname: "sincerita.api.keycrm.app", pathname: "/file-storage/**" }],
    formats: ["image/webp"],
    deviceSizes: [640, 828, 1080, 1200],
    imageSizes: [96, 192, 256, 384],
    qualities: [75],
    minimumCacheTTL: 2678400,
  },
  // Pages of the old WooCommerce shop on this domain that have no match here.
  // Products and categories are matched by name (app/product, app/product-category).
  async redirects() {
    return [
      { source: "/shop", destination: "/", permanent: true },
      { source: "/shop/:path*", destination: "/", permanent: true },
      { source: "/cart", destination: "/", permanent: true },
      { source: "/my-account", destination: "/", permanent: true },
      { source: "/my-account/:path*", destination: "/", permanent: true },
      { source: "/product-tag/:path*", destination: "/", permanent: true },
    ]
  },
}

export default nextConfig
