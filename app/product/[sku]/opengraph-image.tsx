import { readProducts } from "@/lib/catalog"
import sharp from "sharp"

// The product's link preview (Instagram, Telegram, Viber, Facebook): its
// photo, 1200×630, on a blurred copy of itself, from the shop's own domain.
// KeyCRM's file storage turns crawlers away (robots.txt), and its thumbnails
// are too small for the big preview card. Next.js adds og:image with its
// width, height and type.

export const size = { width: 1200, height: 630 }
export const contentType = "image/jpeg"
export const alt = "Фото пряжі SINCERITA"
export const revalidate = 86400

/** The full-size upload behind a KeyCRM thumbnail. */
const fullSize = (url: string) => url.replace("/file-storage/thumbnails/", "/file-storage/")

async function photo(url: string): Promise<Buffer | null> {
  for (const src of [fullSize(url), url]) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(10_000) })
      if (res.ok && res.headers.get("content-type")?.startsWith("image/")) return Buffer.from(await res.arrayBuffer())
    } catch {}
  }
  return null
}

export default async function Image({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params
  const [product] = await readProducts([decodeURIComponent(sku)]).catch(() => [])
  const source = product?.image ? await photo(product.image) : null
  const { width, height } = size
  let jpeg: Buffer
  if (source) {
    const background = await sharp(source).rotate().resize(width, height, { fit: "cover" }).blur(40).modulate({ brightness: 0.9 }).toBuffer()
    const front = await sharp(source).rotate().resize(width, height, { fit: "inside" }).toBuffer()
    jpeg = await sharp(background).composite([{ input: front, gravity: "center" }]).jpeg({ quality: 82 }).toBuffer()
  } else {
    // No photo: the shop's colour, so the preview still has its size.
    jpeg = await sharp({ create: { width, height, channels: 3, background: "#f4f4f5" } }).jpeg().toBuffer()
  }
  return new Response(new Uint8Array(jpeg), {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400, s-maxage=86400" },
  })
}
