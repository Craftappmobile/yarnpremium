// Server-only: checkouts left unfinished. Once a buyer has typed a valid phone
// at checkout, the page saves a draft (contact, cart, where the buyer came from,
// whether they wrote to the assistant). An order with the same checkout id
// deletes it. A draft still there an hour later becomes a lead in KeyCRM
// («Кинутий кошик»), so a manager can write to the buyer in Viber, and is
// counted in the statistics (assistant and Telegram pages).
//
// The lead goes to the pipeline KEYCRM_ABANDONED_PIPELINE_ID names, else to one
// whose name says «кинут…» («Кинуті кошики»), else to the first pipeline.
//
// Redis keys:
//   draft:<checkout id>    JSON Draft (expires after 3 days)
//   drafts:pending         sorted set: checkout id -> last update (ms)
//   draft:phone:<phone>    set when a lead was made for this phone (24 h): one lead a day per buyer

import { readProducts } from "@/lib/catalog"
import { KeycrmError, keycrmGetAll, keycrmSend } from "@/lib/keycrm"
import { isTestOrderEnvironment } from "@/lib/keycrm-order"
import { redis } from "@/lib/redis"
import { formatQuantity } from "@/components/shop/data"
import { countStats } from "@/lib/assistant/stats"
import { campaignTitle, countTelegram, cleanCampaign } from "@/lib/telegram-stats"
import { notifyAbandoned } from "@/lib/telegram-staff"

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
  /** utm_* tags of the visit, if it came by a tagged link. */
  utm?: Record<string, string>
  /** Messages the buyer wrote to the assistant in the week before. */
  assistantMessages?: number
  /** A checkout on the master-class site (app/api/partner/checkout-draft): the master-class the yarn is for. */
  course?: string
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

let pipeline: { id: number; title: string } | null | undefined

/** Where abandoned checkouts go: see the top of this file. */
export async function abandonedPipeline(): Promise<{ id: number; title: string } | null> {
  if (pipeline !== undefined) return pipeline
  const pipelines: any[] = await keycrmGetAll("/pipelines").catch(() => [])
  const named = (p: any) => ({ id: Number(p.id), title: String(p.title ?? p.name ?? "") })
  const configured = Number(process.env.KEYCRM_ABANDONED_PIPELINE_ID)
  const chosen =
    (configured > 0 && pipelines.find((p) => Number(p.id) === configured)) ||
    pipelines.find((p) => /кинут/i.test(String(p.title ?? p.name ?? ""))) ||
    pipelines[0]
  // A configured id KeyCRM didn't list is used as given.
  pipeline = chosen ? named(chosen) : configured > 0 ? { id: configured, title: "" } : null
  return pipeline
}

async function leadPipeline(): Promise<number | null> {
  return (await abandonedPipeline())?.id ?? null
}

/**
 * Where the buyer came from, in words, for the manager. A draft saved before
 * checkouts sent their tags has none at all: unknown, not «без міток».
 */
export function sourceLine(utm: Record<string, string> | undefined, course?: string): string {
  if (!utm) return "невідомо (кошик збережено до того, як сайт почав це записувати)"
  if (utm.utm_source === "yarnmk") return `сайт майстер-класів yarnmk.com.ua${course ? `, пряжа до МК «${course}»` : ""}`
  if (utm.utm_source === "telegram") {
    const where = utm.utm_medium === "bot" ? "бот" : "канал"
    return `Telegram (${where}), пост «${campaignTitle(cleanCampaign(utm.utm_campaign))}»`
  }
  const tags = ["utm_source", "utm_medium", "utm_campaign"].filter((k) => utm[k]).map((k) => `${k}=${utm[k]}`)
  return tags.length ? `посилання з мітками: ${tags.join(", ")}` : "без міток (прямий захід, пошук або закладка)"
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
      const { value, lines } = await createLead(id, draft)
      report.leads++
      await countAbandoned(draft, value)
      if (!isTestOrderEnvironment()) {
        await notifyAbandoned({
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          value,
          lines,
          source: sourceLine(draft.utm, draft.course),
          assistantMessages: draft.assistantMessages ?? 0,
          pipeline: (await abandonedPipeline())?.title || null,
        })
      }
    } catch (e) {
      console.error("[abandoned] lead failed:", (e as Error).message, e instanceof KeycrmError ? e.body.slice(0, 500) : "")
      report.failed++
      // Free the phone for the next run's retry only if the draft is still fresh enough to matter.
      await r.del(PHONE_KEY(draft.phone))
      if (Date.now() - draft.updatedAt < 24 * 3600_000) continue
    }
    await dropDraft(id)
  }
  return report
}

/** The statistics of the assistant's page and, for a visit from Telegram, of the Telegram page. */
async function countAbandoned(draft: Draft, value: number): Promise<void> {
  if (isTestOrderEnvironment()) return
  const assisted = (draft.assistantMessages ?? 0) > 0
  await countStats({
    abandoned: 1,
    abandoned_value: value,
    abandoned_assisted: assisted ? 1 : 0,
    abandoned_assisted_value: assisted ? value : 0,
  })
  if (draft.utm?.utm_source === "telegram") {
    const campaign = cleanCampaign(draft.utm.utm_campaign)
    await countTelegram({ abandoned: 1, abandoned_value: value, [`abandoned:c:${campaign}`]: 1 })
  }
}

/** Makes the lead; returns what the cart was worth and its lines, in words. */
async function createLead(id: string, draft: Draft): Promise<{ value: number; lines: string[] }> {
  const products = new Map((await readProducts(draft.items.map((i) => i.sku))).map((p) => [p.sku, p]))
  const lines = draft.items.flatMap((i) => {
    const p = products.get(i.sku)
    return p ? [{ p, quantity: i.quantity }] : []
  })
  const described = lines.map(({ p, quantity }) => `${p.name} — ${formatQuantity(quantity, p.priceUnit)}`)
  const summary = described.join("\n")
  const sum = Math.round(lines.reduce((s, { p, quantity }) => s + p.price * quantity, 0))
  // The checkout saves the email as typed, half-typed included: KeyCRM refuses a card with one that isn't valid.
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email) ? draft.email : undefined
  const card = {
    title: `${isTestOrderEnvironment() ? "ТЕСТ — " : ""}Кинутий кошик · ${sum} ₴`,
    source_id: SOURCE_ID,
    pipeline_id: (await leadPipeline()) ?? undefined,
    manager_comment: [
      isTestOrderEnvironment() && "ТЕСТ — не обробляти (з тестової версії сайту)",
      "Почала оформлювати замовлення на сайті і не завершила годину тому. Напишіть у Viber.",
      `Звідки: ${sourceLine(draft.utm, draft.course)}`,
      (draft.assistantMessages ?? 0) > 0 && `Писала консультанту на сайті: ${draft.assistantMessages} повід.`,
      summary,
      `Чернетка на сайті: ${id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    contact: { full_name: draft.name || undefined, phone: draft.phone, email },
    products: lines.map(({ p, quantity }) => ({
      sku: p.sku,
      name: p.name,
      price: p.price,
      quantity,
      unit_type: p.priceUnit,
      picture: p.image || undefined,
    })),
  }
  try {
    await keycrmSend("POST", "/pipelines/cards", card)
  } catch (e) {
    if (!(e instanceof KeycrmError && e.status === 422)) throw e
    // Something in the card KeyCRM won't take: the lead still matters more. The cart is in the comment.
    console.error("[abandoned] KeyCRM refused the card, sent without products and email:", e.body.slice(0, 500))
    await keycrmSend("POST", "/pipelines/cards", {
      ...card,
      contact: { full_name: card.contact.full_name, phone: draft.phone },
      products: undefined,
    })
  }
  return { value: sum, lines: described }
}
