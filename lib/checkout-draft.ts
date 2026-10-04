// Server-only: checkouts left unfinished. Once a buyer has typed a valid phone
// at checkout, the page saves a draft (contact and cart). An order with the same
// checkout id deletes it. A draft still there an hour later becomes a lead in
// KeyCRM («Кинутий кошик»), so a manager can write to the buyer in Viber.
//
// Redis keys:
//   draft:<checkout id>    JSON Draft (expires after 3 days)
//   drafts:pending         sorted set: checkout id -> last update (ms)
//   draft:phone:<phone>    set when a lead was made for this phone (24 h): one lead a day per buyer

import { readProducts } from "@/lib/catalog"
import { keycrmGetAll, keycrmSend } from "@/lib/keycrm"
import { isTestOrderEnvironment } from "@/lib/keycrm-order"
import { redis } from "@/lib/redis"
import { formatQuantity } from "@/components/shop/data"

const DRAFT_KEY = (id: string) => `draft:${id}`
const PENDING = "drafts:pending"
const PHONE_KEY = (phone: string) => `draft:phone:${phone}`
const DRAFT_TTL_S = 3 * 24 * 3600
/** How long an unfinished checkout waits before it counts as abandoned. */
export const ABANDONED_AFTER_MS = 60 * 60_000
/** Leads made per cron run, under KeyCRM's rate limit. */
const BATCH = 20
/** Same source as site orders (lib/keycrm-order.ts). */
const SOURCE_ID = 8

export interface Draft {
  phone: string
  name: string
  email: string
  items: { sku: string; quantity: number }[]
  updatedAt: number
}

export async function saveDraft(id: string, draft: Omit<Draft, "updatedAt">): Promise<void> {
  const r = await redis()
  const updatedAt = Date.now()
  await r
    .multi()
    .set(DRAFT_KEY(id), JSON.stringify({ ...draft, updatedAt }), { EX: DRAFT_TTL_S })
    .zAdd(PENDING, { score: updatedAt, value: id })
    .exec()
}

async function dropDraft(id: string): Promise<void> {
  const r = await redis()
  await r.multi().del(DRAFT_KEY(id)).zRem(PENDING, id).exec()
}

/**
 * The checkout became an order: nothing to follow up, for this checkout or
 * another the same buyer left earlier today (a reload starts a new checkout).
 */
export async function markOrdered(id: string, phone: string): Promise<void> {
  const r = await redis()
  await r.multi().del(DRAFT_KEY(id)).zRem(PENDING, id).set(PHONE_KEY(phone), `order:${id}`, { EX: 86400 }).exec()
}

let pipelineId: number | null | undefined

/** KEYCRM_ABANDONED_PIPELINE_ID, or else the first lead pipeline in KeyCRM. */
async function leadPipeline(): Promise<number | null> {
  const configured = Number(process.env.KEYCRM_ABANDONED_PIPELINE_ID)
  if (configured > 0) return configured
  if (pipelineId === undefined) {
    const pipelines = await keycrmGetAll("/pipelines").catch(() => [])
    pipelineId = pipelines[0]?.id ?? null
  }
  return pipelineId ?? null
}

/**
 * Turns checkouts left for an hour into KeyCRM leads. Drafts whose checkout
 * ended in an order are skipped (`ordered` says so for an id).
 */
export async function processAbandoned(ordered: (id: string) => Promise<boolean>): Promise<{ leads: number; skipped: number; failed: number }> {
  const r = await redis()
  const ids = await r.zRangeByScore(PENDING, 0, Date.now() - ABANDONED_AFTER_MS, { LIMIT: { offset: 0, count: BATCH } })
  const report = { leads: 0, skipped: 0, failed: 0 }
  for (const id of ids) {
    const raw = await r.get(DRAFT_KEY(id))
    const draft = raw ? (JSON.parse(raw) as Draft) : null
    // One lead a day per phone, whatever number of checkouts it left.
    const first = draft && !(await ordered(id)) && (await r.set(PHONE_KEY(draft.phone), id, { NX: true, EX: 86400 }))
    if (!draft || !first) {
      report.skipped++
      await dropDraft(id)
      continue
    }
    try {
      await createLead(id, draft)
      report.leads++
    } catch (e) {
      console.error("[abandoned] lead failed:", (e as Error).message)
      report.failed++
      // Free the phone for the next run's retry only if the draft is still fresh enough to matter.
      await r.del(PHONE_KEY(draft.phone))
      if (Date.now() - draft.updatedAt < 24 * 3600_000) continue
    }
    await dropDraft(id)
  }
  return report
}

async function createLead(id: string, draft: Draft): Promise<void> {
  const products = new Map((await readProducts(draft.items.map((i) => i.sku))).map((p) => [p.sku, p]))
  const lines = draft.items.flatMap((i) => {
    const p = products.get(i.sku)
    return p ? [{ p, quantity: i.quantity }] : []
  })
  const summary = lines.map(({ p, quantity }) => `${p.name} — ${formatQuantity(quantity, p.priceUnit)}`).join("\n")
  const sum = Math.round(lines.reduce((s, { p, quantity }) => s + p.price * quantity, 0))
  await keycrmSend("POST", "/pipelines/cards", {
    title: `${isTestOrderEnvironment() ? "ТЕСТ — " : ""}Кинутий кошик · ${sum} ₴`,
    source_id: SOURCE_ID,
    pipeline_id: (await leadPipeline()) ?? undefined,
    manager_comment: [
      isTestOrderEnvironment() && "ТЕСТ — не обробляти (з тестової версії сайту)",
      "Почала оформлювати замовлення на сайті і не завершила годину тому. Напишіть у Viber.",
      summary,
      `Чернетка на сайті: ${id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    contact: { full_name: draft.name || undefined, phone: draft.phone, email: draft.email || undefined },
    products: lines.map(({ p, quantity }) => ({
      sku: p.sku,
      name: p.name,
      price: p.price,
      quantity,
      unit_type: p.priceUnit,
      picture: p.image || undefined,
    })),
  })
}
