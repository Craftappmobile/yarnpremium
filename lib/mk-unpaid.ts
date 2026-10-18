// Server-only: master-class and subscription orders on yarnmk.com.ua left
// unpaid for an hour, reported once each to the shop's staff topic in Telegram
// (lib/telegram-staff.ts), so a manager can write to the buyer. The master-class
// site lists them at /api/partner/unpaid-orders for the shared MK_PARTNER_SECRET
// (lib/partner.ts); its own cron runs only daily, so the shop's abandoned-checkout
// cron asks every 15 minutes. Those orders aren't KeyCRM's: no lead is made.
//
// Redis key: mk:unpaid:<order id>  set when reported (7 days)

import { redis } from "@/lib/redis"
import { notifyUnpaidCourse } from "@/lib/telegram-staff"

const SEEN = (id: string) => `mk:unpaid:${id}`

interface UnpaidOrder {
  id: string
  createdAt: string
  total: number
  email: string
  name: string
  items: string[]
}

/** The master-class site: the first allowed return origin (lib/partner.ts). */
const mkOrigin = () =>
  ((process.env.MK_PARTNER_RETURN_ORIGINS ?? "").split(",")[0]?.trim() || "https://yarnmk.com.ua").replace(/\/+$/, "")

export async function processUnpaidCourses(): Promise<{ reported: number; seen: number } | { skipped: string }> {
  const secret = process.env.MK_PARTNER_SECRET ?? ""
  if (secret.length < 24) return { skipped: "MK_PARTNER_SECRET is not set" }
  // Previews share Redis and the staff group with the live site.
  if (process.env.VERCEL_ENV !== "production") return { skipped: "not production" }
  const res = await fetch(`${mkOrigin()}/api/partner/unpaid-orders`, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  })
  if (!res.ok) return { skipped: `master-class site answered ${res.status}` }
  const { orders = [] } = (await res.json().catch(() => ({}))) as { orders?: UnpaidOrder[] }
  const r = await redis()
  let reported = 0
  for (const o of orders.slice(0, 30)) {
    if (typeof o?.id !== "string" || !o.id) continue
    if (!(await r.set(SEEN(o.id), new Date().toISOString(), { NX: true, EX: 7 * 86400 }))) continue
    await notifyUnpaidCourse({
      total: Number(o.total) || 0,
      name: String(o.name ?? ""),
      email: String(o.email ?? ""),
      items: Array.isArray(o.items) ? o.items.map(String).slice(0, 5) : [],
      createdAt: String(o.createdAt ?? ""),
    })
    reported++
  }
  return { reported, seen: orders.length }
}
