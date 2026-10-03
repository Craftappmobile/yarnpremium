// Server-only: events for Meta ads through the Conversions API, sent from the
// shop's server rather than the buyer's browser, so ad blockers and iOS can't
// lose them and Meta can recognise the buyer by their (hashed) phone and email.
//
// Funnel sent to the «KeyCRM+YanrnPremium» dataset:
//   Contact         first message to the site's shopping assistant   (event_id chat-<conversation>)
//   AddPaymentInfo  order placed with something to pay online        (event_id pay-<KeyCRM order>)
//   Purchase        the online part is paid, or an order with nothing
//                   to pay online is placed                          (event_id order-<KeyCRM order>)
// The browser pixel sends Contact and AddPaymentInfo too, with the same
// event_id, and Meta keeps one of each pair.
//
// Needs META_CAPI_TOKEN (Events Manager → dataset → Settings → Conversions API →
// Generate access token). Sends only from production; META_CAPI_TEST_CODE (the
// code on Events Manager's Test events tab) sends from anywhere, marked as test.

import { createHash } from "node:crypto"
import { META_PIXEL_ID, SITE_URL } from "@/lib/site"
import type { Order } from "@/lib/order"
import { redis } from "@/lib/redis"

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0"

/** What the buyer's request tells about them: needed to match server events to Meta accounts. */
export interface BuyerContext {
  ip?: string
  userAgent?: string
  /** The pixel's _fbp cookie. */
  fbp?: string
  /** The pixel's _fbc cookie: set when the visit came from a Meta ad click. */
  fbc?: string
}

export function buyerContext(req: Request): BuyerContext {
  const cookies = Object.fromEntries(
    (req.headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k, v]) => k && v)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  )
  return {
    ip: req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || undefined,
    userAgent: req.headers.get("user-agent") || undefined,
    fbp: cookies._fbp,
    fbc: cookies._fbc,
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")
/** Meta's normalisation: trimmed, lower case; hashed only when something is left. */
const hashed = (s: string | undefined) => {
  const v = s?.trim().toLowerCase()
  return v ? [sha256(v)] : undefined
}

function userData(ctx: BuyerContext, customer?: Order["customer"], city?: string) {
  const phone = customer?.phone.replace(/\D/g, "")
  return {
    client_ip_address: ctx.ip,
    client_user_agent: ctx.userAgent,
    fbp: ctx.fbp,
    fbc: ctx.fbc,
    em: hashed(customer?.email),
    ph: phone ? [sha256(phone)] : undefined,
    fn: hashed(customer?.firstName),
    ln: hashed(customer?.lastName),
    // City without spaces or punctuation, as Meta asks.
    ct: hashed(city?.replace(/[^\p{L}]/gu, "")),
    country: customer ? hashed("ua") : undefined,
  }
}

interface ServerEvent {
  event_name: string
  event_id: string
  event_source_url: string
  user_data: ReturnType<typeof userData>
  custom_data?: Record<string, unknown>
}

/**
 * Sends one event. `test` (a payment through WayForPay's test merchant, say)
 * goes out only under META_CAPI_TEST_CODE. Never throws: a lost ad signal
 * must not fail an order or a payment.
 */
export async function sendMetaEvent(event: ServerEvent, { test = false } = {}): Promise<void> {
  const token = process.env.META_CAPI_TOKEN
  const testCode = process.env.META_CAPI_TEST_CODE
  if (!token) return
  if (!testCode && (test || process.env.VERCEL_ENV !== "production")) return
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{ ...event, event_time: Math.floor(Date.now() / 1000), action_source: "website" }],
        ...(testCode ? { test_event_code: testCode } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error(`[meta capi] ${event.event_name} ${event.event_id}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  } catch (e) {
    console.error(`[meta capi] ${event.event_name} ${event.event_id}:`, (e as Error).message)
  }
}

export function sendContact(conversationId: string, ctx: BuyerContext) {
  return sendMetaEvent({
    event_name: "Contact",
    event_id: `chat-${conversationId}`,
    event_source_url: SITE_URL,
    user_data: userData(ctx),
    custom_data: { content_name: "Консультант" },
  })
}

function orderData(order: Order) {
  return {
    currency: "UAH",
    value: order.total,
    order_id: String(order.number),
    content_type: "product",
    content_ids: order.items.map((i) => i.sku),
    contents: order.items.map((i) => ({ id: i.sku, quantity: i.quantity, item_price: i.price })),
    num_items: order.items.length,
  }
}

const orderEvent = (name: string, idPrefix: string, order: Order, ctx: BuyerContext): ServerEvent => ({
  event_name: name,
  event_id: `${idPrefix}-${order.number}`,
  event_source_url: `${SITE_URL}/checkout`,
  user_data: userData(ctx, order.customer, order.delivery.city?.title || order.delivery.city?.name),
  custom_data: orderData(order),
})

// The buyer's context is kept with the order for the Purchase sent when WayForPay
// confirms the payment (server to server, so the buyer's request is long gone).
// Meta takes events up to 7 days old.
const CONTEXT_KEY = (siteOrderId: string) => `meta:ctx:${siteOrderId}`

/**
 * A newly placed order: Purchase now when nothing is to be paid online, else
 * AddPaymentInfo now and Purchase once the payment comes through.
 */
export async function sendOrderPlaced(order: Order, siteOrderId: string, ctx: BuyerContext, { test = false } = {}) {
  if (order.payment.now > 0) {
    await (await redis()).set(CONTEXT_KEY(siteOrderId), JSON.stringify(ctx), { EX: 7 * 86400 }).catch(() => {})
    await sendMetaEvent(orderEvent("AddPaymentInfo", "pay", order, ctx), { test })
  } else {
    await sendMetaEvent(orderEvent("Purchase", "order", order, ctx), { test })
  }
}

/** The online part of an order is paid. */
export async function sendOrderPaid(order: Order, siteOrderId: string, { test = false } = {}) {
  const raw = await (await redis()).get(CONTEXT_KEY(siteOrderId)).catch(() => null)
  const ctx = raw ? (JSON.parse(raw) as BuyerContext) : {}
  await sendMetaEvent(orderEvent("Purchase", "order", order, ctx), { test })
}
