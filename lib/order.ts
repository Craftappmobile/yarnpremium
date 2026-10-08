// Delivery and payment options for checkout, the order shape, and the checks
// shared by the checkout form and /api/orders (which sends orders to KeyCRM;
// carrier refs are kept alongside the human-readable names).

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
  { value: "np_courier", label: "Нова Пошта — курʼєр", hint: "За тарифами перевізника" },
  { value: "ukrposhta", label: "Укрпошта — відділення", hint: "За тарифами перевізника" },
  { value: "pickup", label: "Самовивіз", hint: "Безкоштовно" },
]

export type PaymentMethod = "card" | "cod" | "on_pickup"

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  card: "Повна оплата карткою онлайн",
  cod: "Післяплата з авансом",
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
  /** KeyCRM order id, shown to the customer as the order number. */
  number?: number
  customer: { firstName: string; lastName: string; phone: string; email: string }
  /**
   * `quantity` is in `unit` (grams for yarn sold by weight); `price` is per unit.
   * `tail`: grams of it at TAIL_DISCOUNT (end of a spool taken whole); `total` is the line price.
   * `promo`: the promotion `price` comes from, and `oldPrice` the regular price per unit.
   */
  items: {
    id: string
    sku: string
    name: string
    price: number
    quantity: number
    unit: string
    tail?: number
    total?: number
    oldPrice?: number
    promo?: string
    /** Photo for the confirmation page. */
    image?: string
  }[]
  subtotal: number
  total: number
  delivery: OrderDelivery
  /** `paid`: the online part (`now`) has been paid through WayForPay. */
  payment: { method: PaymentMethod; now: number; onReceipt: number; paid?: boolean }
  notes: string
  /** The buyer asked for new-colour letters (lib/newsletter.ts). */
  newsletter?: boolean
  /**
   * Set on an add-on (ADD_ON): the order it was added to, sent in the same parcel.
   * The add-on's lines normally go into that very KeyCRM order (`number` is then
   * the same as `addOnTo.number`); only when KeyCRM won't take them is it its own order.
   */
  addOnTo?: { id: string; number?: number }
  createdAt: string
}

/**
 * The order's id in reports (GA4's transaction, Meta's event and order ids).
 * An add-on usually shares its KeyCRM number with the order it joins, so it
 * gets «-add» after it: otherwise GA4 and Meta would drop it as a repeat.
 */
export function orderRef(order: Pick<Order, "number" | "addOnTo">): string {
  return order.addOnTo ? `${order.addOnTo.number ?? order.number}-add` : String(order.number)
}

/** What the checkout sends to /api/orders. Prices and totals are worked out on the server. */
export interface OrderRequest {
  /** Generated once per checkout; a repeated submit with the same id returns the same order. */
  id: string
  customer: Order["customer"]
  items: { sku: string; quantity: number }[]
  delivery: OrderDelivery
  payment: PaymentMethod
  notes: string
  /** «Надсилати мені нові кольори» ticked. */
  newsletter?: boolean
  /** utm_* parameters of the visit that brought the customer. */
  utm?: Record<string, string>
  /** Present when the buyer wrote to the shopping assistant during the past week. */
  assistant?: { messages: number; skus: string[] }
  /** Present when the buyer saw a product video during the past week (components/shop/video-attribution.ts). */
  video?: { page: boolean; reviewCompleted: boolean; sampleCompleted: boolean }
  /** Honeypot: hidden from people, filled in by bots. */
  website?: string
}

/** What the confirmation page sends to /api/orders/add-on. */
export interface AddOnRequest {
  /** The site id of the order being added to. */
  order: string
  items: { sku: string; quantity: number }[]
}

/**
 * How an add-on is paid, following the order it joins: by card online if that
 * was paid by card, else on receipt with the rest of the parcel (the order's
 * prepayment already covers the delivery).
 */
export function addOnPayment(method: PaymentMethod, total: number): Order["payment"] {
  return method === "card" ? { method, now: total, onReceipt: 0 } : { method, now: 0, onReceipt: total }
}

/** A cart line that can't be bought as ordered any more (returned by /api/orders with 409). */
export interface StockChange {
  sku: string
  name: string
  /** What can be bought now, in `unit`; 0 = sold out. */
  available: number
  unit: string
}

/** "+380XXXXXXXXX", or null when it isn't a Ukrainian mobile/landline number. */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "")
  if (digits.length === 10 && digits.startsWith("0")) digits = `38${digits}`
  if (digits.length === 11 && digits.startsWith("80")) digits = `3${digits}`
  return digits.length === 12 && digits.startsWith("380") ? `+${digits}` : null
}

/** Field errors for the contact and delivery part of an order, keyed like the form fields. */
export function validateOrderFields(customer: Order["customer"], delivery: OrderDelivery): Record<string, string> {
  const e: Record<string, string> = {}
  if (!customer.firstName.trim()) e.firstName = "Вкажіть імʼя"
  if (!customer.lastName.trim()) e.lastName = "Вкажіть прізвище"
  if (!normalizePhone(customer.phone)) e.phone = "Вкажіть номер телефону, наприклад +380 67 123 45 67"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())) e.email = "Перевірте email, наприклад name@example.com"
  if (delivery.method !== "pickup") {
    if (!delivery.city?.name.trim()) e.city = "Оберіть населений пункт"
    if (delivery.method === "np_courier") {
      if (!delivery.address?.street.trim()) e.street = "Вкажіть вулицю"
      if (!delivery.address?.house.trim()) e.house = "Вкажіть номер будинку"
    } else if (!delivery.point?.name.trim()) {
      e.point = delivery.method === "np_postomat" ? "Оберіть поштомат" : "Оберіть відділення"
    }
  }
  return e
}

/** The payment actually used: cash on delivery falls back to card when nothing would be left after the prepayment. */
export function effectivePaymentMethod(method: PaymentMethod, delivery: DeliveryMethod, total: number): PaymentMethod {
  const allowed = paymentMethodsFor(delivery)
  const chosen = allowed.includes(method) ? method : allowed[0]
  return chosen === "cod" && total <= COD_PREPAYMENT ? "card" : chosen
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
