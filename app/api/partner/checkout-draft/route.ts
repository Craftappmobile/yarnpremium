import { type NextRequest, NextResponse } from "next/server"
import { saveDraft } from "@/lib/checkout-draft"
import { normalizePhone } from "@/lib/order"
import { partnerAuthorized } from "@/lib/partner"
import { redisConfigured } from "@/lib/redis"

// Yarn checkouts on the master-class site (lib/partner.ts): once the buyer has
// typed a valid phone, that site's server sends the contact and cart here, so
// a checkout left unfinished becomes a «Кинутий кошик» lead like the shop's own
// (lib/checkout-draft.ts). An order the site places with the same phone (via
// /api/partner/orders) cancels it.
export const dynamic = "force-dynamic"

const text = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "")

export async function POST(req: NextRequest) {
  if (!partnerAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (!redisConfigured()) return NextResponse.json({ ok: false })
  const body = await req.json().catch(() => null)
  const id = text(body?.id, 80)
  const phone = normalizePhone(text(body?.phone, 40))
  const items = Array.isArray(body?.items)
    ? body.items
        .slice(0, 20)
        .map((i: any) => ({ sku: text(i?.sku, 64), quantity: Math.floor(Number(i?.quantity)) }))
        .filter((i: { sku: string; quantity: number }) => i.sku && i.quantity > 0)
    : []
  if (!/^mk-[\w-]{8,64}$/.test(id) || !phone || items.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const courseSlug = text(body?.course?.slug, 120)
  await saveDraft(id, {
    phone,
    name: text(body?.name),
    email: text(body?.email, 200),
    items,
    utm: { utm_source: "yarnmk", utm_medium: "mk", ...(courseSlug ? { utm_campaign: courseSlug } : {}) },
    course: text(body?.course?.title, 200) || undefined,
  })
  return NextResponse.json({ ok: true })
}
