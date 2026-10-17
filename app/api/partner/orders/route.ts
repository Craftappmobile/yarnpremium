import { type NextRequest, NextResponse } from "next/server"
import { placeOrder } from "@/lib/place-order"
import { PARTNER_SITE, partnerAuthorized, partnerReturnUrl } from "@/lib/partner"
import type { OrderRequest } from "@/lib/order"

// Orders from the master-class site's server (lib/partner.ts). Same body as
// /api/orders plus `partner: { ref, returnUrl }`; the answer is the same too
// ({ order, payment }), and the master-class site opens the payment form itself.
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!partnerAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as (OrderRequest & { partner?: { ref?: unknown; returnUrl?: unknown } }) | null
  const ref = typeof body?.partner?.ref === "string" ? body.partner.ref.trim().slice(0, 64) : ""
  const returnUrl = partnerReturnUrl(body?.partner?.returnUrl)
  if (!body || !ref || !returnUrl) return NextResponse.json({ error: "bad_partner" }, { status: 400 })
  return placeOrder(req, body, { site: PARTNER_SITE, ref, returnUrl })
}
