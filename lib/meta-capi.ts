// Server-only: events for Meta ads through the Conversions API, sent from the
// shop's server rather than the buyer's browser, so ad blockers and iOS can't
// lose them and Meta can recognise the buyer by their (hashed) phone and email.
//
// Funnel sent to the «KeyCRM+YanrnPremium» dataset:
//   ViewContent     a product card is opened                         (event_id view-<random>)
//   AddToCart       a product goes into the cart                     (event_id cart-<random>)
//   InitiateCheckout the checkout page opens with a cart             (event_id checkout-<random>)
//                   all three passed on by app/api/activity
//   Contact         first message to the site's shopping assistant   (event_id chat-<conversation>)
//   AddPaymentInfo  order placed with something to pay online        (event_id pay-<KeyCRM order>)
//   Purchase        the online part is paid, or an order with nothing
//                   to pay online is placed                          (event_id order-<KeyCRM order>)
// The browser pixel sends ViewContent, AddToCart, InitiateCheckout, Contact and
// AddPaymentInfo too, with the same event_id, and Meta keeps one of each pair.
//   Purchase        an order from Direct (or another non-site channel) is paid
//                   in KeyCRM: lib/keycrm-purchase.ts, read every half hour by
//                   app/api/cron/purchases               (event_id crm-<KeyCRM order>)
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

/** A buyer's contact details; any may be missing. */
export interface Contact {
  firstName?: string
  lastName?: string
  phone?: string
  email?: string
}

export function userData(ctx: BuyerContext, customer?: Contact, city?: string) {
  const phone = customer?.phone?.replace(/\D/g, "")
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

export interface ServerEvent {
  event_name: string
  event_id: string
  /** "website" unless said otherwise; "chat" for a sale made in a messenger. */
  action_source?: "website" | "chat" | "phone_call" | "other"
  event_source_url?: string
  /** Unix seconds; now unless the event happened earlier (Meta takes up to 7 days back). */
  event_time?: number
  user_data: ReturnType<typeof userData>
  custom_data?: Record<string, unknown>
}

/** Meta's limit for one request to the events endpoint. */
const BATCH = 1000

/**
 * Sends events, up to a thousand a request; true when Meta accepted all of
 * them. `test` (a payment through WayForPay's test merchant, say) goes out only
 * under META_CAPI_TEST_CODE. Never throws: a lost ad signal must not fail an
 * order or a payment.
 */
export async function sendMetaEvents(events: ServerEvent[], { test = false } = {}): Promise<boolean> {
  const token = process.env.META_CAPI_TOKEN
  const testCode = process.env.META_CAPI_TEST_CODE
  if (!token || events.length === 0) return false
  if (!testCode && (test || process.env.VERCEL_ENV !== "production")) return false
  const label = events.length === 1 ? `${events[0].event_name} ${events[0].event_id}` : `${events.length} events`
  const now = Math.floor(Date.now() / 1000)
  let ok = true
  for (let i = 0; i < events.length; i += BATCH) {
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: events.slice(i, i + BATCH).map((e) => ({ action_source: "website", ...e, event_time: e.event_time ?? now })),
          ...(testCode ? { test_event_code: testCode } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) console.error(`[meta capi] ${label}: ${res.status} ${(await res.text()).slice(0, 300)}`)
      ok &&= res.ok
    } catch (e) {
      console.error(`[meta capi] ${label}:`, (e as Error).message)
      ok = false
    }
  }
  return ok
}

/** Sends one event; true when Meta accepted it (see sendMetaEvents). */
export const sendMetaEvent = (event: ServerEvent, opts: { test?: boolean } = {}) => sendMetaEvents([event], opts)

export async function sendContact(conversationId: string, ctx: BuyerContext): Promise<void> {
  await sendMetaEvent({
    event_name: "Contact",
    event_id: `chat-${conversationId}`,
    event_source_url: SITE_URL,
    user_data: userData(ctx),
    custom_data: { content_name: "Консультант" },
  })
}

/**
 * Products browsed on the site: a card opened (ViewContent), added to the cart
 * (AddToCart), or the checkout opened with the cart (InitiateCheckout).
 */
export type BrowseEventName = "ViewContent" | "AddToCart" | "InitiateCheckout"

export async function sendBrowseEvent(
  name: BrowseEventName,
  eventId: string,
  url: string,
  lines: { sku: string; quantity: number; price: number; total: number }[],
  ctx: BuyerContext,
): Promise<void> {
  await sendMetaEvent({
    event_name: name,
    event_id: eventId,
    event_source_url: url,
    user_data: userData(ctx),
    custom_data: {
      currency: "UAH",
      value: Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100,
      content_type: "product",
      content_ids: lines.map((l) => l.sku),
      contents: lines.map((l) => ({ id: l.sku, quantity: l.quantity, item_price: l.price })),
      num_items: lines.length,
    },
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
