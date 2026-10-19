import { NextResponse } from "next/server"
import { redis, redisConfigured } from "@/lib/redis"
import { keyPhoto } from "@/lib/reviews-intake"
import { tgFile } from "@/lib/telegram"

// A photo of a published review (lib/reviews.ts), fetched from Telegram, where
// the manager posted it. Only photos a review shows are known here, so neither
// the chat screenshots nor anything else in the group can be reached. A file
// never changes under its id: the CDN keeps it for a year.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!redisConfigured() || !/^[\w-]{8,64}$/.test(id)) return new NextResponse(null, { status: 404 })
  const fileId = await (await redis()).get(keyPhoto(id))
  if (!fileId) return new NextResponse(null, { status: 404 })
  try {
    const { data, path } = await tgFile(fileId)
    const type = /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg"
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" },
    })
  } catch (e) {
    console.error("[review-photo]", id, (e as Error).message)
    return new NextResponse(null, { status: 502 })
  }
}
