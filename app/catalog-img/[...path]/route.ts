import { NextResponse } from "next/server"
import { keycrmFileUrl } from "@/lib/catalog-image"

// A KeyCRM product photo on the shop's own domain, for Meta's catalog crawler
// (lib/catalog-image.ts). Only KeyCRM upload paths pass, so this is no open
// proxy. Uploads never change under the same name: the CDN keeps each for a year.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const source = keycrmFileUrl((await params).path.join("/"))
  if (!source) return new NextResponse(null, { status: 404 })
  let res: Response
  try {
    res = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(15000) })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
  const type = res.headers.get("content-type") ?? ""
  if (!res.ok || !res.body || !type.startsWith("image/")) {
    return new NextResponse(null, { status: res.status === 404 ? 404 : 502 })
  }
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  })
}
