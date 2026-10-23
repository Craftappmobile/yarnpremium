// Server-only: orders a manager makes in KeyCRM for a buyer who left a
// checkout on the site (lib/checkout-draft.ts) get the same «📨 Надіслати
// клієнту» link in the manager comment as the site's own orders
// (lib/order-message.ts): such a buyer has no chat in KeyCRM for its ⚡
// button either. Run by the abandoned-checkout cron every 15 minutes: an order
// placed within LEAD_DAYS of the buyer's lead, matched by phone.
//
// Redis keys:
//   abandoned:lead:<phone>     when a lead was made for the phone (LEAD_DAYS)
//   abandoned:linked:<order>   the order has its link (7 days)

import { keycrmGetPages, keycrmSend } from "@/lib/keycrm"
import { normalizePhone } from "@/lib/order"
import { SEND_MARK, sendUrl } from "@/lib/order-message"
import { redis } from "@/lib/redis"

const LEAD_DAYS = 14
const LEAD_KEY = (phone: string) => `abandoned:lead:${phone}`
const LINKED_KEY = (id: number) => `abandoned:linked:${id}`

/** Remembers that the phone's buyer got an abandoned-checkout lead. */
export async function rememberLead(phone: string): Promise<void> {
  await (await redis()).set(LEAD_KEY(phone), String(Date.now()), { EX: LEAD_DAYS * 86400 })
}

interface KeycrmOrder {
  id: number
  created_at?: string
  manager_comment?: string | null
  buyer?: { phone?: string | null } | null
}

export async function linkAbandonedOrders(): Promise<{ orders: number; linked: number } | { skipped: string }> {
  // Previews share Redis and KeyCRM with the live site.
  if (process.env.VERCEL_ENV !== "production") return { skipped: "not production" }
  const r = await redis()
  const now = Date.now()
  const day = (t: number) => new Date(t).toISOString().slice(0, 10)
  // Up to tomorrow: the upper date may be read as its midnight.
  const { items } = await keycrmGetPages<KeycrmOrder>(
    "/order",
    { include: "buyer", "filter[created_between]": `${day(now - 86400_000)},${day(now + 86400_000)}` },
    20,
  )
  let linked = 0
  for (const o of items) {
    if (String(o.manager_comment ?? "").includes(SEND_MARK) || (await r.exists(LINKED_KEY(o.id)))) continue
    const phone = normalizePhone(String(o.buyer?.phone ?? ""))
    const lead = phone ? Number(await r.get(LEAD_KEY(phone))) : 0
    // The order came after the lead: the manager's follow-up, not an order from before it.
    if (!lead || Date.parse(o.created_at ?? "") < lead) continue
    try {
      await keycrmSend("PUT", `/order/${o.id}`, {
        manager_comment: [o.manager_comment, `${SEND_MARK} ${sendUrl(o.id)}`].filter(Boolean).join("\n\n"),
      })
      await r.set(LINKED_KEY(o.id), "1", { EX: 7 * 86400 })
      linked++
    } catch (e) {
      console.error(`[abandoned] send link on KeyCRM order ${o.id} not added:`, (e as Error).message)
    }
  }
  return { orders: items.length, linked }
}
