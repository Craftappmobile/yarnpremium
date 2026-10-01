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
  /** KeyCRM order id, shown to the customer as the order number. */
  number?: number
  customer: { firstName: string; lastName: string; phone: string; email: string }
  /** `quantity` is in `unit` (grams for yarn sold by weight); `price` is per unit. */
  items: { id: string; sku: string; name: string; price: number; quantity: number; unit: string }[]
  subtotal: number
  total: number
  delivery: OrderDelivery
  payment: { method: PaymentMethod; now: number; onReceipt: number }
  notes: string
  createdAt: string
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
  /** utm_* parameters of the visit that brought the customer. */
  utm?: Record<string, string>
  /** Honeypot: hidden from people, filled in by bots. */
  website?: string
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
  if (!normalizePhone(customer.phone)) e.phone = "Вкажіть телефон у форматі +380XXXXXXXXX"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())) e.email = "Вкажіть коректний email"
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
