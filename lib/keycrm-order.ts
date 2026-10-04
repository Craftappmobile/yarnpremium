// Server-only: turns a site order into a KeyCRM order (POST /order). It stays in
// KeyCRM's first status («Нове»); the manager takes it from there.

import { keycrmGetAll, keycrmSend } from "@/lib/keycrm"
import { redis } from "@/lib/redis"
import { TAIL_DISCOUNT } from "@/components/shop/data"
import { PAYMENT_LABELS, PICKUP_POINT, describeDelivery, type Order } from "@/lib/order"

/** KeyCRM order source «yarnpremium» (yarnpremium.com.ua). */
const SOURCE_ID = 8
/** KeyCRM delivery services the buyer can pick on the site, found by name. */
const DELIVERY_SERVICE: Record<"novaposhta" | "ukrposhta", RegExp> = {
  novaposhta: /нова\s*пошта|nova\s*poshta|novaposhta/i,
  ukrposhta: /укрпошт|ukrposhta|ukrpost/i,
}

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

/** The KeyCRM payment the online part of an order is booked under (card in full, or the COD prepayment). */
export function onlinePaymentMethodId(method: Order["payment"]["method"]): number {
  return method === "cod" ? PAYMENT_METHOD_ID.prepayment : PAYMENT_METHOD_ID.card
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

/** The buyer's use of the shopping assistant before this order. */
export interface AssistantUse {
  messages: number
  /** Order lines that were added from the assistant's product cards. */
  skus: string[]
}

/** The POST /order body. Exported for tests. */
export function toKeycrmOrder(
  order: Order,
  siteOrderId: string,
  utm: Record<string, string> = {},
  deliveryServiceId?: number,
  assistant?: AssistantUse,
) {
  const { customer: c, delivery: d } = order
  const promos = [...new Set(order.items.flatMap((i) => (i.promo ? [i.promo] : [])))]
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
    order.newsletter && "Погодилась отримувати нові кольори на пошту",
    promos.length > 0 && `Акція: ${promos.join(", ")} — ціни в замовленні вже зі знижкою`,
    assistant &&
      `Консультант (ШІ): ${assistant.messages} повід. до замовлення` +
        (assistant.skus.length ? `; з його карток додано: ${assistant.skus.join(", ")}` : ""),
  ].filter(Boolean)

  return {
    source_id: SOURCE_ID,
    source_uuid: siteOrderId,
    buyer: { full_name: fullName, email: c.email, phone: c.phone },
    buyer_comment: order.notes || undefined,
    manager_comment: managerNotes.join("\n"),
    // The discounted end of a spool is its own line, so the manager sees why it's cheaper.
    products: order.items.flatMap((i) => {
      const line = {
        sku: i.sku,
        name: i.name,
        price: i.price,
        unit_type: i.unit,
        ...(i.promo && i.oldPrice ? { comment: `${i.promo}: звичайна ціна ${i.oldPrice} ₴ за ${i.unit}` } : {}),
      }
      if (!i.tail) return [{ ...line, quantity: i.quantity }]
      return [
        ...(i.quantity > i.tail ? [{ ...line, quantity: i.quantity - i.tail }] : []),
        {
          ...line,
          quantity: i.tail,
          price: Math.round(i.price * (1 - TAIL_DISCOUNT) * 10000) / 10000,
          comment: `Залишок бобіни: окремо не продається, знижка ${TAIL_DISCOUNT * 100}%`,
        },
      ]
    }),
    shipping: {
      // The carrier the buyer picked; for pickup the manager decides.
      delivery_service_id: deliveryServiceId,
      // Nova Poshta branch/locker: KeyCRM links it from its ref (needs delivery_service_id).
      warehouse_ref:
        deliveryServiceId && (d.method === "np_warehouse" || d.method === "np_postomat") ? d.point?.ref : undefined,
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

/** KeyCRM delivery service for the buyer's carrier, looked up by name once a day. */
async function deliveryServiceId(method: Order["delivery"]["method"]): Promise<number | undefined> {
  const key = method.startsWith("np_") ? "novaposhta" : method === "ukrposhta" ? "ukrposhta" : null
  if (!key) return undefined
  const r = await redis()
  let services = JSON.parse((await r.get("keycrm:delivery_services")) ?? "null") as
    | { id: number; name?: string; alias?: string; source_name?: string }[]
    | null
  if (!services) {
    services = await keycrmGetAll("/order/delivery-service")
    await r.set("keycrm:delivery_services", JSON.stringify(services), { EX: 86400 })
  }
  const found = services.find((s) => DELIVERY_SERVICE[key].test(`${s.name ?? ""} ${s.alias ?? ""} ${s.source_name ?? ""}`))
  if (!found) console.error(`[orders] no KeyCRM delivery service for ${key}`)
  return found?.id
}

/** Creates the order in KeyCRM and returns its id. */
export async function createKeycrmOrder(
  order: Order,
  siteOrderId: string,
  utm?: Record<string, string>,
  assistant?: AssistantUse,
): Promise<number> {
  // Without the carrier the order still goes through; the manager sets it.
  const serviceId = await deliveryServiceId(order.delivery.method).catch((e) => {
    console.error("[orders] delivery services lookup failed:", (e as Error).message)
    return undefined
  })
  const created = await keycrmSend<{ id: number }>("POST", "/order", toKeycrmOrder(order, siteOrderId, utm, serviceId, assistant))
  if (!created?.id) throw new Error("KeyCRM did not return an order id")
  return created.id
}
