import { type NextRequest, NextResponse, after } from "next/server"
import { readProducts } from "@/lib/catalog"
import { type BrowseEventName, buyerContext, sendBrowseEvent } from "@/lib/meta-capi"
import { SITE_URL } from "@/lib/site"
import { lineTotal } from "@/components/shop/data"

// The server's copy of the pixel's ViewContent, AddToCart and InitiateCheckout
// (components/shop/analytics.tsx): Safari and ad blockers drop part of the
// browser's events, the server's reach Meta (the path names neither Meta nor
// tracking, so blockers leave it alone too). Both carry the same event_id, so
// Meta counts each once. Prices come from the catalog, not the browser.
export const dynamic = "force-dynamic"

const NAMES: BrowseEventName[] = ["ViewContent", "AddToCart", "InitiateCheckout"]
const EVENT_ID = /^(view|cart|checkout)-[A-Za-z0-9-]{8,64}$/
/** More lines than any real cart holds. */
const MAX_LINES = 60

/** `{sku, quantity}` for one product, or `lines: [{sku, quantity}, …]` for a cart. */
function linesFrom(body: Record<string, unknown>): { sku: string; quantity: number }[] | null {
  const raw: unknown[] = Array.isArray(body.lines) ? body.lines : [{ sku: body.sku, quantity: body.quantity }]
  if (raw.length === 0 || raw.length > MAX_LINES) return null
  const lines = raw.map((l) => {
    const line = (l ?? {}) as Record<string, unknown>
    return { sku: typeof line.sku === "string" ? line.sku.slice(0, 64) : "", quantity: Number(line.quantity) }
  })
  return lines.every((l) => l.sku && l.quantity > 0 && l.quantity <= 100000) ? lines : null
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const name = body?.event as BrowseEventName
  const eventId = typeof body?.id === "string" ? body.id : ""
  const lines = body ? linesFrom(body) : null
  if (!NAMES.includes(name) || !EVENT_ID.test(eventId) || !lines) {
    return new NextResponse(null, { status: 400 })
  }
  // Only pages of the shop itself.
  const url = typeof body?.url === "string" && body.url.startsWith(`${SITE_URL}/`) ? body.url.slice(0, 500) : SITE_URL

  const products = new Map((await readProducts([...new Set(lines.map((l) => l.sku))])).map((p) => [p.sku, p]))
  const priced = lines.flatMap(({ sku, quantity }) => {
    const product = products.get(sku)
    return product ? [{ sku, quantity, price: product.price, total: lineTotal(product, quantity) }] : []
  })
  if (priced.length === 0) return new NextResponse(null, { status: 404 })
  const ctx = buyerContext(req)
  after(() => sendBrowseEvent(name, eventId, url, priced, ctx))
  return new NextResponse(null, { status: 204 })
}
