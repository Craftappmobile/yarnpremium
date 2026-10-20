// Server-only: sales of yarn by weight in KeyCRM (Instagram, phone, the site)
// that break the shop's rule, reported to their own staff topic in Telegram
// (lib/telegram-staff.ts, «/remnants_here <code>»). The rule: less than the
// minimum (100 g, cashmere 50 g) is sold only when it is all there is, and a
// sale leaves either nothing or at least the minimum behind. The site keeps
// to it by itself (components/shop/data.ts); in KeyCRM nothing stops a
// manager, so the abandoned-checkout cron runs this every 15 minutes.
//
// Each product of an order is checked once, a run after it is first seen, so
// the stock it left has reached the site by then (KeyCRM's stock webhook, the
// catalog sync). What it left is the stock now plus what later orders took.
// The first run only takes note of the orders there are: those aren't reported.
//
// Redis keys:
//   remnants:line:<order id>:<sku>:<grams>  "new" when first seen, "done" once checked (3 days)
//   remnants:started                         when the first run was

import { keycrmGetAll, keycrmGetPages } from "@/lib/keycrm"
import { readStockLevels } from "@/lib/catalog"
import { redis } from "@/lib/redis"
import { notifyRemnants, readStaffChat } from "@/lib/telegram-staff"

const LINE = (order: number, sku: string, grams: number) => `remnants:line:${order}:${sku}:${grams}`
const STARTED = "remnants:started"
const LINE_TTL = 3 * 86400
/** Orders placed in this many days are read; a sale is usually changed, if at all, the same day or the next. */
const DAYS = 2
/** KeyCRM's status group of cancelled orders (1 new … 5 completed, 6 cancelled): their stock is back. */
const CANCELLED = 6

interface KeycrmOrder {
  id: number
  source_id?: number
  status_group_id?: number
  products?: { sku?: string | null; offer?: { sku?: string | null } | null; quantity?: number | string }[]
}

/** Whether selling `sold` and leaving `left` breaks the rule. */
export function breaksRule(sold: number, left: number, minQty: number): boolean {
  return left > 0 && (sold < minQty || left < minQty)
}

/** One product of an order that broke the rule, in words for the staff topic. */
export function describeBreach(b: { sku: string; name: string; sold: number; left: number; minQty: number }): string {
  const { sold, left, minQty: min } = b
  const all = sold + left
  const why =
    sold < min && left < min
      ? `менше ${min} г не продаємо і не лишаємо`
      : sold < min
        ? `менше ${min} г продаємо лише весь залишок`
        : `залишок менше ${min} г лишати не можна`
  const right =
    all - min >= min ? `від ${min} до ${all - min} г або весь залишок, ${all} г` : `лише весь залишок, ${all} г, або нічого`
  return `${b.name} (${b.sku}): продали ${sold} г, на складі лишилось ${left} г — ${why}. Можна було: ${right}.`
}

/** Grams of each SKU in an order; a spool's discounted end is a line of its own, so lines add up. */
function gramsBySku(order: KeycrmOrder): Map<string, number> {
  const grams = new Map<string, number>()
  for (const p of order.products ?? []) {
    const sku = String(p.sku || p.offer?.sku || "").trim()
    const quantity = Number(p.quantity)
    if (sku && quantity > 0) grams.set(sku, (grams.get(sku) ?? 0) + quantity)
  }
  return grams
}

/** KeyCRM's order sources by id («Instagram», «yarnpremium»), looked up once a day. */
async function sourceNames(): Promise<Map<number, string>> {
  const r = await redis()
  let sources = JSON.parse((await r.get("keycrm:sources")) ?? "null") as { id: number; name?: string }[] | null
  if (!sources) {
    sources = await keycrmGetAll<{ id: number; name?: string }>("/order/source")
    await r.set("keycrm:sources", JSON.stringify(sources.map((s) => ({ id: s.id, name: s.name }))), { EX: 86400 })
  }
  return new Map(sources.flatMap((s) => (s.name ? [[s.id, s.name] as [number, string]] : [])))
}

export async function checkRemnants(): Promise<
  { orders: number; checked: number; reported: number; first: boolean } | { skipped: string }
> {
  // Previews share Redis and the staff group with the live site.
  if (process.env.VERCEL_ENV !== "production") return { skipped: "not production" }
  if (!(await readStaffChat("remnants"))) return { skipped: "no remnants topic (/remnants_here)" }

  const now = Date.now()
  const day = (t: number) => new Date(t).toISOString().slice(0, 10)
  // Up to tomorrow: the upper date may be read as its midnight.
  const { items } = await keycrmGetPages<KeycrmOrder>(
    "/order",
    { include: "products", "filter[created_between]": `${day(now - DAYS * 86400_000)},${day(now + 86400_000)}` },
    20,
  )
  const orders = items
    .filter((o) => Number(o.status_group_id) !== CANCELLED)
    .sort((a, b) => a.id - b.id)
    .map((o) => ({ order: o, grams: gramsBySku(o) }))
  const levels = new Map(
    (await readStockLevels([...new Set(orders.flatMap((o) => [...o.grams.keys()]))]))
      .filter((l) => l.unit === "г")
      .map((l) => [l.sku, l]),
  )

  const r = await redis()
  const first = !(await r.get(STARTED))
  const lines = orders.flatMap(({ order, grams }, i) =>
    [...grams].filter(([sku]) => levels.has(sku)).map(([sku, sold]) => ({ order, i, sku, sold })),
  )
  const states = lines.length ? await r.mGet(lines.map((l) => LINE(l.order.id, l.sku, l.sold))) : []

  const breaches = new Map<number, string[]>()
  const checked: string[] = []
  const seen: string[] = []
  lines.forEach((l, n) => {
    const key = LINE(l.order.id, l.sku, l.sold)
    if (states[n] === "done") return
    // A line is checked a run after it appears; the first run only takes note.
    if (!first && states[n] !== "new") {
      seen.push(key)
      return
    }
    checked.push(key)
    if (first) return
    const level = levels.get(l.sku)!
    const later = orders.slice(l.i + 1).reduce((sum, o) => sum + (o.grams.get(l.sku) ?? 0), 0)
    const left = level.stock + later
    if (!breaksRule(l.sold, left, level.minQty)) return
    const text = describeBreach({ sku: l.sku, name: level.name, sold: l.sold, left, minQty: level.minQty })
    breaches.set(l.order.id, [...(breaches.get(l.order.id) ?? []), text])
  })

  let reported = 0
  const unsent = new Set<number>()
  if (breaches.size) {
    const sources = await sourceNames().catch(() => new Map<number, string>())
    for (const [id, texts] of breaches) {
      const order = orders.find((o) => o.order.id === id)!.order
      if (await notifyRemnants({ order: id, source: sources.get(Number(order.source_id)), lines: texts })) reported++
      else unsent.add(id)
    }
  }

  const tx = r.multi()
  for (const key of seen) tx.set(key, "new", { EX: LINE_TTL })
  // An order Telegram didn't take is tried again next run.
  for (const key of checked) if (!unsent.has(Number(key.split(":")[2]))) tx.set(key, "done", { EX: LINE_TTL })
  if (first) tx.set(STARTED, new Date(now).toISOString())
  await tx.exec()
  return { orders: orders.length, checked: checked.length, reported, first }
}
