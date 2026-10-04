import { type NextRequest, NextResponse } from "next/server"
import { saveDraft } from "@/lib/checkout-draft"
import { normalizePhone } from "@/lib/order"
import { redisConfigured } from "@/lib/redis"

// The checkout saves its contact and cart here once the phone is filled in
// (lib/checkout-draft.ts), so an unfinished checkout can be followed up.
export const dynamic = "force-dynamic"

const text = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "")

export async function POST(req: NextRequest) {
  if (!redisConfigured()) return NextResponse.json({ ok: false })
  const body = await req.json().catch(() => null)
  const id = text(body?.id, 64)
  const phone = normalizePhone(text(body?.phone, 40))
  const items = Array.isArray(body?.items)
    ? body.items
        .slice(0, 50)
        .map((i: any) => ({ sku: text(i?.sku, 64), quantity: Math.floor(Number(i?.quantity)) }))
        .filter((i: { sku: string; quantity: number }) => i.sku && i.quantity > 0)
    : []
  if (!/^[\w-]{8,64}$/.test(id) || !phone || items.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  await saveDraft(id, { phone, name: text(body?.name), email: text(body?.email), items })
  return NextResponse.json({ ok: true })
}
