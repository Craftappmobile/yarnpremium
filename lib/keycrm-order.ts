// Server-only: turns a site order into a KeyCRM order (POST /order) and moves it
// to the «Виробництво» status, which reserves the stock in KeyCRM.

import { keycrmGetAll, keycrmSend } from "@/lib/keycrm"
import { redis } from "@/lib/redis"
import { PAYMENT_LABELS, PICKUP_POINT, describeDelivery, type Order } from "@/lib/order"

/** KeyCRM order source «yarnpremium» (yarnpremium.com.ua). */
const SOURCE_ID = 8
/** New site orders go straight to this status so KeyCRM reserves their stock. */
const RESERVING_STATUS = "Виробництво"

/**
 * KeyCRM payment method ids for the site's payment options. Still to be
 * confirmed with the manager (decisions page, items 19–22).
 */
const PAYMENT_METHOD_ID = {
  card: 2, // «Банківська картка»
  prepayment: 7, // «Банківський переказ (передоплата)»
  cashOnDelivery: 6, // «Накладений платіж»
  cash: 1, // «Cash»
}

/** Preview deployments share the real KeyCRM: their orders are marked and don't reserve stock. */
export function isTestOrderEnvironment(): boolean {
  return process.env.VERCEL_ENV !== "production"
}

function carrier(method: Order["delivery"]["method"]): string {
  if (method.startsWith("np_")) return "Нова Пошта"
  return method === "ukrposhta" ? "Укрпошта" : "Самовивіз"
}

function payments(order: Order) {
  const { method, now, onReceipt } = order.payment
  const total = order.total
  if (method === "card") return [{ payment_method_id: PAYMENT_METHOD_ID.card, amount: total, status: "not_paid" }]
  if (method === "on_pickup") return [{ payment_method_id: PAYMENT_METHOD_ID.cash, amount: total, status: "not_paid" }]
  return [
    { payment_method_id: PAYMENT_METHOD_ID.prepayment, amount: now, status: "not_paid", description: "Передоплата" },
    { payment_method_id: PAYMENT_METHOD_ID.cashOnDelivery, amount: onReceipt, status: "not_paid", description: "При отриманні" },
  ].filter((p) => p.amount > 0)
}

/** The POST /order body. Exported for tests. */
export function toKeycrmOrder(order: Order, siteOrderId: string, utm: Record<string, string> = {}) {
  const { customer: c, delivery: d } = order
  const fullName = `${c.lastName} ${c.firstName}`.trim()
  const address = d.address
    ? [d.address.street, d.address.house && `буд. ${d.address.house}`, d.address.flat && `кв. ${d.address.flat}`]
        .filter(Boolean)
        .join(", ")
    : undefined

  const managerNotes = [
    isTestOrderEnvironment() && "ТЕСТ — не обробляти (замовлення з тестової версії сайту)",
    `Доставка: ${describeDelivery(d)}`,
    d.method === "ukrposhta" && d.point?.postcode && `Укрпошта: індекс ${d.point.postcode}`,
    `Оплата: ${PAYMENT_LABELS[order.payment.method]}` +
      (order.payment.onReceipt > 0 ? ` — зараз ${order.payment.now} ₴, при отриманні ${order.payment.onReceipt} ₴` : ""),
    `Номер на сайті: ${siteOrderId}`,
  ].filter(Boolean)

  return {
    source_id: SOURCE_ID,
    source_uuid: siteOrderId,
    buyer: { full_name: fullName, email: c.email, phone: c.phone },
    buyer_comment: order.notes || undefined,
    manager_comment: managerNotes.join("\n"),
    products: order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      unit_type: i.unit,
    })),
    shipping: {
      shipping_service: carrier(d.method),
      shipping_address_country: "Україна",
      shipping_address_city: d.method === "pickup" ? undefined : d.city?.title || d.city?.name,
      shipping_address_region: d.city?.region,
      shipping_address_zip: d.point?.postcode,
      shipping_receive_point: d.method === "pickup" ? PICKUP_POINT.address : d.point?.name,
      shipping_secondary_line: address,
      recipient_full_name: fullName,
      recipient_phone: c.phone,
    },
    payments: payments(order),
    marketing: Object.keys(utm).length ? utm : undefined,
  }
}

/** Id of the «Виробництво» status, looked up by name once a day. */
async function reservingStatusId(): Promise<number | null> {
  const r = await redis()
  const cached = await r.get("keycrm:status:reserving")
  if (cached) return Number(cached)
  const statuses = await keycrmGetAll<{ id: number; name: string }>("/order/status")
  const status = statuses.find((s) => s.name?.trim().toLowerCase() === RESERVING_STATUS.toLowerCase())
  if (!status) return null
  await r.set("keycrm:status:reserving", String(status.id), { EX: 86400 })
  return status.id
}

/** Creates the order in KeyCRM and returns its id. Only creation failing is fatal. */
export async function createKeycrmOrder(order: Order, siteOrderId: string, utm?: Record<string, string>): Promise<number> {
  const created = await keycrmSend<{ id: number }>("POST", "/order", toKeycrmOrder(order, siteOrderId, utm))
  if (!created?.id) throw new Error("KeyCRM did not return an order id")

  if (!isTestOrderEnvironment()) {
    // If this fails the order still exists in KeyCRM, just in its first status.
    try {
      const statusId = await reservingStatusId()
      if (statusId) await keycrmSend("PUT", `/order/${created.id}`, { status_id: statusId })
      else console.error(`[orders] status «${RESERVING_STATUS}» not found in KeyCRM`)
    } catch (e) {
      console.error(`[orders] could not move order ${created.id} to «${RESERVING_STATUS}»:`, (e as Error).message)
    }
  }
  return created.id
}
