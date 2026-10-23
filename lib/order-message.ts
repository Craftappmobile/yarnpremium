// Server-only: the order as a message for the buyer, like the one KeyCRM's ⚡
// button sends into a chat. A buyer from the site has no chat in KeyCRM, so
// each site order's manager comment carries a link (sendUrl) to a page
// (app/nadislaty/[id]) with the text and buttons that open the buyer's Viber,
// WhatsApp or Telegram with it; so does an order a manager makes for a buyer
// who left a checkout (lib/abandoned-orders.ts). The link is signed: the page shows the buyer's
// order to whoever has it, so only KeyCRM has it.

import { createHmac, timingSafeEqual } from "node:crypto"
import { keycrmGet } from "@/lib/keycrm"
import { SITE_URL } from "@/lib/site"

const secret = () => `send:${process.env.KEYCRM_API_KEY ?? ""}`

export const sendToken = (id: number) => createHmac("sha256", secret()).update(String(id)).digest("hex").slice(0, 20)

export function sendTokenValid(id: number, token: string): boolean {
  const want = Buffer.from(sendToken(id))
  const got = Buffer.from(token)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** The manager comment's line before the link. */
export const SEND_MARK = "📨 Надіслати клієнту:"

export const sendUrl = (id: number) => `${SITE_URL}/nadislaty/${id}?t=${sendToken(id)}`

interface KeycrmOrder {
  id: number
  grand_total?: number | string
  buyer?: { full_name?: string | null; phone?: string | null } | null
  products?: { name?: string; quantity?: number | string; price?: number | string; price_sold?: number | string | null; unit_type?: string | null }[]
  payments?: { amount?: number | string; status?: string }[]
}

const uah = (n: number) => `${n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UAH`
const price = (n: number) => `${n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} UAH`

export interface OrderMessage {
  id: number
  name: string
  /** Digits only, with the country code: 380… */
  phone: string
  text: string
}

/** The KeyCRM order as the buyer's message: its lines, what is paid and what is left. Null when there is no such order. */
export async function orderMessage(id: number): Promise<OrderMessage | null> {
  const order = await keycrmGet<KeycrmOrder>(`/order/${id}`, { include: "buyer,products,payments" }).catch(() => null)
  if (!order?.id) return null
  const lines = (order.products ?? []).map((p, i) => {
    const quantity = Number(p.quantity) || 0
    const each = Number(p.price_sold ?? p.price) || 0
    const unit = String(p.unit_type ?? "").trim() || "шт"
    return `${i + 1}. ${p.name ?? ""} * ${quantity.toLocaleString("uk-UA")} ${unit} * ${price(each)} = ${uah(Math.round(quantity * each * 100) / 100)}`
  })
  const total = Number(order.grand_total) || 0
  const paid = (order.payments ?? []).filter((p) => p.status === "paid").reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const text = [
    `Ваше замовлення №${order.id}:`,
    "",
    ...lines,
    "",
    `Разом: ${uah(total)}`,
    `Сплачено: ${paid > 0 ? uah(paid) : "—"}`,
    `Залишок до оплати: ${uah(Math.max(0, Math.round((total - paid) * 100) / 100))}`,
  ].join("\n")
  return {
    id: order.id,
    name: String(order.buyer?.full_name ?? "").trim(),
    phone: String(order.buyer?.phone ?? "").replace(/\D/g, ""),
    text,
  }
}
