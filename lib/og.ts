// Open Graph tags (link previews in Instagram, Telegram, Viber, Facebook).
//
// Next.js doesn't merge a page's `openGraph` with the layout's: the page's
// replaces it whole, and og:type, og:site_name and og:locale vanish. Every
// page that sets its own goes through `openGraph()`, which puts them back
// (scripts/check-og.mjs fails the build otherwise).
//
// Every preview image has its size: Meta draws the big card only when it
// knows it before downloading the picture. The site's image
// (app/opengraph-image.png) and the products' (app/product/[sku]/opengraph-image.tsx)
// get theirs from Next.js; any other image goes through `ogImage()`.

import { readFileSync } from "node:fs"
import path from "node:path"
import type { Metadata } from "next"
import sharp from "sharp"
import { BRAND } from "@/lib/site"

type OpenGraph = NonNullable<Metadata["openGraph"]>

export const OG_DEFAULTS = { type: "website", siteName: BRAND, locale: "uk_UA" } as const

/** app/opengraph-image.png: a page's own `openGraph` hides it from the page, so it is named again. */
const SITE_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  type: "image/png",
  // The same as app/opengraph-image.alt.txt (not read at run time: Vercel's functions don't carry app/'s files).
  alt: "SINCERITA — італійська пряжа преміум якості: меринос, кашемір, шовк, альпака",
}

/**
 * A page's Open Graph tags with the shop's own added, and the site's
 * picture when the page has none. `ownImage`: the page has an
 * opengraph-image file of its own, which an image named here would hide.
 */
export function openGraph(og: OpenGraph = {}, { ownImage = false } = {}): OpenGraph {
  return { ...OG_DEFAULTS, ...(ownImage ? {} : { images: [SITE_IMAGE] }), ...og } as OpenGraph
}

/**
 * A preview image with its width and height, read from the file when it is
 * one of the site's own (public/…, at build time: blog posts are built ahead);
 * null for none.
 */
export async function ogImage(src: string | null | undefined, alt: string) {
  if (!src) return null
  if (!src.startsWith("/")) return { url: src, alt }
  try {
    const meta = await sharp(readFileSync(path.join(process.cwd(), "public", src))).metadata()
    return { url: src, alt, width: meta.width, height: meta.height }
  } catch {
    return { url: src, alt }
  }
}
