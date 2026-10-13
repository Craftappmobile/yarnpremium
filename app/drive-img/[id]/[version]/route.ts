import { NextResponse } from "next/server"
import { DRIVE_FILES, driveApiKey, driveFileUrl } from "@/lib/google-drive"
import { knownDrivePhoto } from "@/lib/product-photos"

// A product photo from Google Drive (lib/product-photos.ts) on the shop's own
// domain. Only photos the catalog sync found pass, so this is no open proxy.
// Phone photos are several megabytes, often HEIC: each is turned into a WebP
// at most PHOTO_SIZE px on its long side, which the page's image optimizer then
// fits to each slot. The path changes whenever the file does, so the CDN keeps
// each for a year.

const PHOTO_SIZE = 1600
/** Larger files aren't fetched: nobody uploads a product photo this big. */
const MAX_BYTES = 60 * 1024 * 1024

const fail = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } })

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) })
  if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null
  return Buffer.from(await res.arrayBuffer())
}

async function toWebp(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default
  return sharp(input, { limitInputPixels: 200_000_000 })
    .rotate() // as the phone held it (EXIF orientation)
    .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
}

/**
 * Drive's own JPEG rendering of the photo, for formats the server can't read
 * (HEIC from iPhones): its thumbnail link, asked for at full size.
 */
async function driveRendering(id: string): Promise<Buffer | null> {
  const url = `${DRIVE_FILES}/${encodeURIComponent(id)}?fields=thumbnailLink&supportsAllDrives=true&key=${encodeURIComponent(driveApiKey())}`
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
  if (!res.ok) return null
  const link = ((await res.json()) as { thumbnailLink?: string }).thumbnailLink
  return link ? download(link.replace(/=s\d+[^/]*$/, `=s${PHOTO_SIZE}`)) : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  const { id } = await params
  if (!/^[\w-]{10,200}$/.test(id) || !(await knownDrivePhoto(id).catch(() => null))) return fail(404)

  let webp: Buffer
  try {
    const original = await download(driveFileUrl(id))
    if (!original) return fail(502)
    try {
      webp = await toWebp(original)
    } catch {
      const rendering = await driveRendering(id)
      if (!rendering) return fail(502)
      webp = await toWebp(rendering)
    }
  } catch {
    return fail(502)
  }
  return new NextResponse(new Uint8Array(webp), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  })
}
