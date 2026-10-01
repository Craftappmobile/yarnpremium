/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
}

export default nextConfig
