import { type NextRequest, NextResponse, after } from "next/server"
import { readProducts } from "@/lib/catalog"
import { type BrowseEventName, buyerContext, sendBrowseEvent } from "@/lib/meta-capi"
import { SITE_URL } from "@/lib/site"
import { lineTotal } from "@/components/shop/data"

// The server's copy of the pixel's ViewContent and AddToCart (components/shop/analytics.tsx):
// Safari and ad blockers drop part of the browser's events, the server's reach Meta
// (the path names neither Meta nor tracking, so blockers leave it alone too).
// Both carry the same event_id, so Meta counts each once. Prices come from the
// catalog, not the browser.
export const dynamic = "force-dynamic"

const NAMES: BrowseEventName[] = ["ViewContent", "AddToCart"]
const EVENT_ID = /^(view|cart)-[A-Za-z0-9-]{8,64}$/

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const name = body?.event as BrowseEventName
  const eventId = typeof body?.id === "string" ? body.id : ""
  const sku = typeof body?.sku === "string" ? body.sku.slice(0, 64) : ""
  const quantity = Number(body?.quantity)
  if (!NAMES.includes(name) || !EVENT_ID.test(eventId) || !sku || !(quantity > 0 && quantity <= 100000)) {
    return new NextResponse(null, { status: 400 })
  }
  // Only pages of the shop itself.
  const url = typeof body?.url === "string" && body.url.startsWith(`${SITE_URL}/`) ? body.url.slice(0, 500) : SITE_URL

  const [product] = await readProducts([sku])
  if (!product) return new NextResponse(null, { status: 404 })
  const ctx = buyerContext(req)
  after(() =>
    sendBrowseEvent(name, eventId, url, { sku, quantity, price: product.price, total: lineTotal(product, quantity) }, ctx),
  )
  return new NextResponse(null, { status: 204 })
}
