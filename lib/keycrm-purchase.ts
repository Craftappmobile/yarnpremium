// Purchases made outside the site (Instagram Direct, Facebook, phone, …) for
// Meta's ads: a KeyCRM order paid in full becomes a Purchase in the
// «KeyCRM+YanrnPremium» dataset, matched to the buyer by their hashed phone and
// email, once per order. Two ways in, sharing the once-only key:
//   app/api/cron/purchases     reads the orders of the last days
//   app/api/keycrm/purchase    a KeyCRM trigger's webhook, if one is set up
// The site's own orders are reported by the site itself (lib/meta-capi.ts) and
// are skipped here.
//
// Off since 2026-10-07: KeyCRM's own «Надіслати конверсію у Facebook» trigger
// (payment status → Сплачено / Оплачено зверх / Часткова оплата, source not
// yarnpremium, once per order through the tag «Meta покупка») sends these
// purchases with the chat's PSID/IGSID, which ties them to the conversation an
// ad started. Both at once would count each purchase twice. Should KeyCRM's
// Facebook connection lapse (it has to be renewed every 60 days), put the cron
// back in vercel.json.

import { keycrmGet, keycrmGetPages } from "@/lib/keycrm"
import { type ServerEvent, sendMetaEvents, userData } from "@/lib/meta-capi"
import { redis } from "@/lib/redis"

/** KeyCRM order source «yarnpremium» (the site), as in lib/keycrm-order.ts. */
export const SITE_SOURCE_ID = 8
export const SENT_KEY = (id: number) => `meta:crm-purchase:${id}`
/** Set after a sweep of the whole week; until it expires, runs read the last two days only. */
const WEEK_SWEPT_KEY = "meta:crm-purchase:week-swept"
const INCLUDE = "buyer,products,shipping"
/** Meta takes events up to 7 days old; an hour to spare. */
const MAX_AGE_MS = 7 * 86400_000 - 3600_000

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v))

/**
 * The Purchase for a KeyCRM order, or why there is none. Dated when the order
 * was placed, or now if that is too long ago for Meta.
 */
export function purchaseEvent(order: any, now = Date.now()): { event?: ServerEvent; skip?: string } {
  if (Number(order.source_id) === SITE_SOURCE_ID) return { skip: "an order from the site: the site reports it itself" }
  // Only when KeyCRM gives the field: an order that isn't (fully) paid is not a purchase yet.
  if (order.payment_status && !["paid", "overpaid"].includes(order.payment_status)) {
    return { skip: `payment status is ${order.payment_status}` }
  }

  const products: any[] = Array.isArray(order.products) ? order.products : []
  const lines = products.map((p) => ({
    id: String(p.sku || p.offer?.sku || p.offer_id || p.id || ""),
    quantity: num(p.quantity) || 1,
    item_price: num(p.price_sold ?? p.price) || 0,
  }))
  const value = num(order.grand_total ?? order.total) || lines.reduce((s, l) => s + l.quantity * l.item_price, 0)
  if (!(value > 0)) return { skip: "no order total" }

  const placed = Date.parse(order.ordered_at ?? order.created_at ?? "")
  const at = Number.isNaN(placed) || placed > now || now - placed > MAX_AGE_MS ? now : placed

  // KeyCRM keeps one full name; the site writes it «Прізвище Ім'я».
  const [lastName, ...rest] = String(order.buyer?.full_name ?? "").trim().split(/\s+/)
  const event: ServerEvent = {
    event_name: "Purchase",
    event_id: `crm-${order.id}`,
    event_time: Math.floor(at / 1000),
    action_source: "chat",
    user_data: userData(
      {},
      { phone: order.buyer?.phone, email: order.buyer?.email, lastName, firstName: rest.join(" ") || undefined },
      order.shipping?.shipping_address_city,
    ),
    custom_data: {
      currency: order.currency || "UAH",
      value,
      order_id: String(order.id),
      content_type: "product",
      content_ids: lines.map((l) => l.id).filter(Boolean),
      contents: lines.filter((l) => l.id),
      num_items: lines.length,
    },
  }
  if (!event.user_data.ph && !event.user_data.em) return { skip: "the buyer has no phone or email to match" }
  return { event }
}

/** One order read back from KeyCRM, and its Purchase or why there is none. */
export async function purchaseFor(orderId: number): Promise<{ event?: ServerEvent; skip?: string; order: any }> {
  const order = await keycrmGet<any>(`/order/${orderId}`, { include: INCLUDE })
  return { ...purchaseEvent(order), order }
}

export interface PurchaseSyncReport {
  days: number
  /** Orders read, and KeyCRM's count for the period (more means the read stopped early). */
  orders: number
  total: number
  paid: number
  sent: number
  alreadySent: number
  skipped: Record<string, number>
}

/**
 * Sends the paid orders of the last two days (the whole week once a day, which
 * also covers the first run) that Meta hasn't had yet, in one request.
 */
export async function syncPurchases({ maxPages = 30 } = {}): Promise<PurchaseSyncReport> {
  const r = await redis()
  const now = Date.now()
  const days = (await r.get(WEEK_SWEPT_KEY)) ? 2 : 7
  const day = (t: number) => new Date(t).toISOString().slice(0, 10)
  // Up to tomorrow: the upper date may be read as its midnight.
  const { items, total } = await keycrmGetPages<any>(
    "/order",
    { include: INCLUDE, "filter[created_between]": `${day(now - days * 86400_000)},${day(now + 86400_000)}` },
    maxPages,
  )

  const report: PurchaseSyncReport = { days, orders: items.length, total, paid: 0, sent: 0, alreadySent: 0, skipped: {} }
  const batch: { id: number; event: ServerEvent }[] = []
  for (const order of items) {
    if (order.payment_status !== "paid" && order.payment_status !== "overpaid") continue
    report.paid++
    const { event, skip } = purchaseEvent(order, now)
    if (!event) {
      report.skipped[skip!] = (report.skipped[skip!] ?? 0) + 1
      continue
    }
    // Claimed before sending, so a webhook arriving meanwhile doesn't send it too.
    if (!(await r.set(SENT_KEY(order.id), "1", { NX: true, EX: 60 * 86400 }))) {
      report.alreadySent++
      continue
    }
    batch.push({ id: order.id, event })
  }

  if (batch.length > 0 && !(await sendMetaEvents(batch.map((b) => b.event)))) {
    // Not sent (Meta refused them, or this isn't the live site): free them for the next run.
    await Promise.all(batch.map((b) => r.del(SENT_KEY(b.id))))
    throw new Error(`Meta did not take ${batch.length} purchases, see the log`)
  }
  report.sent = batch.length
  if (days === 7) await r.set(WEEK_SWEPT_KEY, "1", { EX: 86400 })
  return report
}
