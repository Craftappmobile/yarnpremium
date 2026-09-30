// Delivery and payment options for checkout, plus the order shape the checkout
// produces. The order is structured so it can later be sent to KeyCRM as-is
// (carrier refs are kept alongside the human-readable names).

/** Prepayment taken online for cash-on-delivery orders (₴). */
export const COD_PREPAYMENT = 200

export const PICKUP_POINT = {
  address: "м. Хмельницький, вул. Романа Шухевича, 20",
  hours: "Пн–Пт 10:00–18:00, Сб–Нд — вихідні",
}

export type DeliveryMethod = "np_warehouse" | "np_postomat" | "np_courier" | "ukrposhta" | "pickup"

export const DELIVERY_METHODS: { value: DeliveryMethod; label: string; hint: string }[] = [
  { value: "np_warehouse", label: "Нова Пошта — відділення", hint: "За тарифами перевізника" },
  { value: "np_postomat", label: "Нова Пошта — поштомат", hint: "За тарифами перевізника" },
  { value: "np_courier", label: "Нова Пошта — кур'єр", hint: "За тарифами перевізника" },
  { value: "ukrposhta", label: "Укрпошта — відділення", hint: "За тарифами перевізника" },
  { value: "pickup", label: "Самовивіз", hint: "Безкоштовно" },
]

export type PaymentMethod = "card" | "cod" | "on_pickup"

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  card: "Повна оплата карткою онлайн",
  cod: `Накладений платіж (передоплата ${COD_PREPAYMENT} ₴)`,
  on_pickup: "Оплата при отриманні в магазині",
}

/** Payment options offered for a delivery method; the first one is the default. */
export function paymentMethodsFor(delivery: DeliveryMethod): PaymentMethod[] {
  return delivery === "pickup" ? ["card", "on_pickup"] : ["card", "cod"]
}

/** How much is paid online now vs. on receipt. */
export function paymentSplit(method: PaymentMethod, total: number): { now: number; onReceipt: number } {
  if (method === "card") return { now: total, onReceipt: 0 }
  if (method === "on_pickup") return { now: 0, onReceipt: total }
  const now = Math.min(COD_PREPAYMENT, total)
  return { now, onReceipt: total - now }
}

export interface OrderDelivery {
  method: DeliveryMethod
  /**
   * Settlement; `name` is the label shown to the customer.
   * Nova Poshta: `ref` = city ref, `settlementRef` = settlement ref (for street search).
   * Ukrposhta: `ref` = address-classifier CITY_ID; `title` = bare settlement name,
   * `region`/`district` (+ classifier ids) identify it for the shipment in KeyCRM.
   */
  city?: {
    name: string
    ref?: string
    settlementRef?: string
    title?: string
    region?: string
    regionId?: string
    district?: string
    districtId?: string
  }
  /**
   * Nova Poshta branch/postomat or Ukrposhta office. `ref` = carrier id when picked from the API.
   * Ukrposhta: `ref` = classifier office ID, `postcode` = office index (the recipient postcode).
   */
  point?: { name: string; ref?: string; postcode?: string }
  /** Courier delivery address. */
  address?: { street: string; streetRef?: string; house: string; flat?: string }
}

export interface Order {
  customer: { firstName: string; lastName: string; phone: string; email: string }
  items: { id: string; sku: string; name: string; price: number; quantity: number }[]
  subtotal: number
  discount: number
  coupon: string | null
  total: number
  delivery: OrderDelivery
  payment: { method: PaymentMethod; now: number; onReceipt: number }
  notes: string
  createdAt: string
}

/** Single-line delivery summary for confirmations. */
export function describeDelivery(d: OrderDelivery): string {
  const label = DELIVERY_METHODS.find((m) => m.value === d.method)?.label ?? d.method
  if (d.method === "pickup") return `${label}: ${PICKUP_POINT.address}`
  const parts = [d.city?.name]
  if (d.point) parts.push(d.point.name)
  if (d.address) parts.push([d.address.street, d.address.house, d.address.flat && `кв. ${d.address.flat}`].filter(Boolean).join(", "))
  return `${label}: ${parts.filter(Boolean).join(", ")}`
}
