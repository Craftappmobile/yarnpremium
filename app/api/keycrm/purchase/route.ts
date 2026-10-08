import { type NextRequest, NextResponse } from "next/server"
import { keycrmConfigured, webhookAuthorized } from "@/lib/keycrm"
import { SENT_KEY, purchaseFor } from "@/lib/keycrm-purchase"
import { sendMetaEvent } from "@/lib/meta-capi"
import { redis } from "@/lib/redis"

// Purchases made outside the site (Instagram Direct, Facebook, …) for Meta's
// ads (lib/keycrm-purchase.ts). app/api/cron/purchases sends them without any
// setup in KeyCRM; this webhook is the faster way in, for a
// KeyCRM trigger («Зміна статусу оплати» → Сплачено / Оплачено зверх):
//   /api/keycrm/purchase?token=<KEYCRM_PURCHASE_SECRET>
// (KEYCRM_WEBHOOK_SECRET, the stock webhook's, is accepted too).
// The order is read back from KeyCRM and sent to the Conversions API as a
// Purchase, once per order whichever way it comes.
//
// Check without sending: open …/api/keycrm/purchase?token=…&order=<KeyCRM order id>
// in a browser; it shows what would go to Meta.
export const dynamic = "force-dynamic"

const authorized = (req: NextRequest) => webhookAuthorized(req, "KEYCRM_PURCHASE_SECRET") || webhookAuthorized(req)

/** The order id in KeyCRM's webhook, wherever the payload keeps it. */
function orderIdFrom(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, any>
  for (const v of [p.order_id, p.context?.order_id, p.context?.id, p.data?.order_id, p.data?.id, p.order?.id, p.id]) {
    const n = Number(v)
    if (Number.isInteger(n) && n > 0) return n
  }
  return null
}

// The check: what would be sent for ?order=<id>, without sending it.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 })
  const orderId = Number(req.nextUrl.searchParams.get("order"))
  if (!Number.isInteger(orderId) || orderId <= 0) return new NextResponse("ok — add &order=<KeyCRM order id> to check one")
  let result: Awaited<ReturnType<typeof purchaseFor>>
  try {
    result = await purchaseFor(orderId)
  } catch (e) {
    return NextResponse.json({ error: `KeyCRM order ${orderId}: ${(e as Error).message}` }, { status: 502 })
  }
  const { event, skip, order } = result
  const sent = await (await redis()).get(SENT_KEY(orderId))
  return NextResponse.json({
    order: { id: orderId, source_id: order.source_id, payment_status: order.payment_status, grand_total: order.grand_total },
    would_send: skip ? null : event,
    skipped: skip ?? null,
    already_sent: Boolean(sent),
  })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!keycrmConfigured()) return NextResponse.json({ error: "KeyCRM is not configured" }, { status: 503 })

  const raw = await req.text()
  let payload: unknown = null
  try {
    payload = JSON.parse(raw)
  } catch {
    // Not JSON: nothing to read the order from.
  }
  const orderId = orderIdFrom(payload)
  if (!orderId) {
    // 200 so KeyCRM doesn't keep retrying; the log shows what arrived.
    console.warn("[keycrm-purchase] no order id in:", raw.slice(0, 1000))
    return NextResponse.json({ ok: true, sent: false })
  }

  const r = await redis()
  // Once per order, however often its payment status changes.
  if (!(await r.set(SENT_KEY(orderId), "1", { NX: true, EX: 60 * 86400 }))) {
    return NextResponse.json({ ok: true, sent: false, reason: "already sent" })
  }
  try {
    const { event, skip } = await purchaseFor(orderId)
    if (!event) {
      await r.del(SENT_KEY(orderId))
      console.log(`[keycrm-purchase] order ${orderId} skipped: ${skip}`)
      return NextResponse.json({ ok: true, sent: false, reason: skip })
    }
    if (!(await sendMetaEvent(event))) {
      // Not sent (Meta refused it, or this isn't the live site): free the order for another try.
      await r.del(SENT_KEY(orderId))
      return NextResponse.json({ ok: true, sent: false, reason: "not sent to Meta, see the log" })
    }
    console.log(`[keycrm-purchase] order ${orderId}: Purchase ${event.custom_data?.value} ₴ sent to Meta`)
    return NextResponse.json({ ok: true, sent: true })
  } catch (e) {
    await r.del(SENT_KEY(orderId))
    console.error(`[keycrm-purchase] order ${orderId} failed:`, (e as Error).message)
    // 5xx: KeyCRM tries again (three attempts in all).
    return NextResponse.json({ error: "try again" }, { status: 502 })
  }
}
