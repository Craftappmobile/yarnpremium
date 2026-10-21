// Server-only: the weight of a spool, weighed once and written in the staff
// group's «Вага» topic, becomes its stock in KeyCRM. Managers then read the
// weight in KeyCRM (and buyers see it on the site) instead of asking for the
// same spool to be weighed again.
//
// A message holds one spool a line, its SKU and its net weight in grams:
//   MO362-1 326
//   MO362-2 412 г
// The spool's number is required (each spool weighs its own); a colour alone
// («MO362») is answered with its spools to choose from.
//
// The weight is what is on the spool, reserved yarn included: KeyCRM takes the
// reserve off when it shows what is available. It is set on the warehouse that
// holds the spool (the shop keeps its stock in one) through
// PUT /offers/stocks, which KeyCRM logs as «Оновлення через API» in the stock
// movements and reports back through the stock webhook (app/api/keycrm/webhook).
//
// The topic is the one where someone wrote «/weights_here <code>» (the code
// of lib/telegram-staff.ts, shown on /admin/telegram).
//
// Redis keys:
//   tg:weights:topic       JSON  { chatId, threadId?, title, at }
//   tg:weights:warehouse   id of the warehouse last written to (for a spool with no stock anywhere)
//   tg:weights:log         list  the last 200 weighings, newest first

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { type PhotoTarget, applyStockUpdates, readPhotoTargets } from "@/lib/catalog"
import { KeycrmError, keycrmBackground, keycrmGet, keycrmSend } from "@/lib/keycrm"
import { redis } from "@/lib/redis"
import { findOffer, spoolKey } from "@/lib/telegram-photos"
import { staffCode } from "@/lib/telegram-staff"
import { esc, tg } from "@/lib/telegram"

const KEY_TOPIC = "tg:weights:topic"
const KEY_WAREHOUSE = "tg:weights:warehouse"
const KEY_LOG = "tg:weights:log"
/** Lines of one message. */
const MAX_LINES = 40
/** A change this big gets a ⚠️: a typo is likelier than a mistake of that size. */
const BIG_CHANGE = 50

export interface WeightsTopic {
  chatId: number
  threadId?: number
  title: string
  at: string
}

export interface Weighing {
  at: string
  /** Who wrote it, as Telegram names them. */
  by: string
  sku: string
  before: number
  after: number
}

export async function readWeightsTopic(): Promise<WeightsTopic | null> {
  const raw = await (await redis()).get(KEY_TOPIC)
  return raw ? JSON.parse(raw) : null
}

export async function readWeighings(): Promise<Weighing[]> {
  return (await (await redis()).lRange(KEY_LOG, 0, 199)).map((json) => JSON.parse(json))
}

const inThread = (threadId?: number) => (threadId ? { message_thread_id: threadId } : {})

/** «MO362-1 326», «mo 362 - 1: 326 г», «MO362-1 — 326,5гр»: SKU and grams; null for any other line. */
export function parseWeightLine(line: string): { sku: string; grams: number } | null {
  const m = line
    .trim()
    .match(/^(\p{L}[\p{L}\d\s]*?\d+(?:\s*[-–—]\s*\d+)?)\s*[:=—–-]?\s+(\d+(?:[.,]\d+)?)\s*(?:г|гр|g|gr)?\.?$/iu)
  if (!m) return null
  return { sku: m[1].replace(/\s*[-–—]\s*/g, "-").replace(/\s+/g, ""), grams: Number(m[2].replace(",", ".")) }
}

/**
 * Group messages: «/weights_here <code>» and «/weights_off <code>» anywhere,
 * and everything posted in the weights topic. True when the message was
 * dealt with here, so nothing else answers it.
 */
export async function handleWeightsMessage(message: any): Promise<boolean> {
  const text = String(message.text ?? "").trim()
  const chatId: number = message.chat.id
  const threadId: number | undefined = message.is_topic_message ? message.message_thread_id : undefined
  const reply = (t: string) =>
    tg("sendMessage", {
      chat_id: chatId,
      ...inThread(threadId),
      text: t,
      parse_mode: "HTML",
      reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    }).catch((e) => console.error("[weights] reply:", (e as Error).message))
  const r = await redis()

  const command = text.match(/^\/(weights_here|weights_off)(?:@\w+)?(?:\s+(\S+))?/)
  if (command) {
    if (command[2] !== staffCode()) {
      await reply("Потрібен код зі сторінки статистики Telegram на сайті: /weights_here КОД")
      return true
    }
    if (command[1] === "weights_off") {
      await r.del(KEY_TOPIC)
      await reply("Вага з цієї гілки більше не потрапляє в KeyCRM.")
      return true
    }
    const topicName = message.reply_to_message?.forum_topic_created?.name
    const title = [message.chat.title, topicName].filter(Boolean).join(" → ") || String(chatId)
    const topic: WeightsTopic = { chatId, ...(threadId ? { threadId } : {}), title, at: new Date().toISOString() }
    await r.set(KEY_TOPIC, JSON.stringify(topic))
    await reply(
      [
        "✅ Вага з цієї гілки тепер стає залишком у KeyCRM і на сайті.",
        "",
        "Пишіть артикул бобіни і чисту вагу в грамах, кожну бобіну з нового рядка:",
        "MO362-1 326",
        "MO362-2 412",
      ].join("\n"),
    )
    return true
  }

  const topic = await readWeightsTopic()
  if (!topic || topic.chatId !== chatId || (topic.threadId ?? undefined) !== threadId) return false
  if (message.from?.is_bot || !text) return true

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const parsed = lines.map((line) => ({ line, w: parseWeightLine(line) }))
  if (!parsed.some((p) => p.w)) {
    // Talk between colleagues: answered only when it looks like a weighing gone wrong.
    if (/\d/.test(text) && lines.length <= MAX_LINES) {
      await reply("Не зрозумів. Пишіть артикул бобіни і вагу в грамах, кожну з нового рядка, наприклад:\nMO362-1 326")
    }
    return true
  }
  const by = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || "—"
  // Answer Telegram now; KeyCRM may take a while.
  after(() =>
    weigh(parsed.slice(0, MAX_LINES), by)
      .then((answer) => reply(answer))
      .catch((e) => reply(`❌ ${esc((e as Error).message)}`)),
  )
  return true
}

export async function weigh(lines: { line: string; w: { sku: string; grams: number } | null }[], by: string): Promise<string> {
  const targets = await readPhotoTargets()
  const out: string[] = []
  const changed: string[] = []
  await keycrmBackground(async () => {
    for (const { line, w } of lines) {
      if (!w) {
        out.push(`❔ «${esc(line)}» — не зрозумів, пропускаю`)
        continue
      }
      try {
        out.push(await weighOne(w.sku, w.grams, targets, by, changed))
      } catch (e) {
        const note = e instanceof KeycrmError ? `KeyCRM: ${e.message} ${e.body.slice(0, 200)}` : (e as Error).message
        out.push(`❌ <b>${esc(w.sku)}</b>: ${esc(note)}`)
      }
    }
  })
  if (changed.length) {
    try {
      revalidatePath("/")
      revalidatePath("/kategoriya/[slug]", "page")
      for (const sku of changed) revalidatePath(`/product/${encodeURIComponent(sku)}`)
    } catch {}
  }
  return out.join("\n")
}

interface StockRow {
  id: number
  sku?: string
  quantity?: number
  reserve?: number
  warehouse?: { id: number; name?: string; quantity?: number; reserve?: number }[]
}

async function weighOne(sku: string, grams: number, targets: PhotoTarget[], by: string, changed: string[]): Promise<string> {
  const key = spoolKey(sku)
  if (!/-\d+$/.test(key)) {
    // A colour: which spool?
    const spools = targets.filter((t) => spoolKey(t.sku).replace(/-\d+$/, "") === key && /-\d+$/.test(spoolKey(t.sku)))
    if (spools.length) {
      return `❔ <b>${esc(sku)}</b>: вкажіть бобіну — ${esc(spools.map((t) => t.sku).join(", "))}`
    }
  }
  const target = targets.find((t) => spoolKey(t.sku) === key) ?? (await findOffer(sku))
  if (!target) return `❌ <b>${esc(sku)}</b>: такого артикула немає в KeyCRM`

  const res = await keycrmGet<{ data?: StockRow[] }>("/offers/stocks", {
    "filter[offers_id]": target.offerId,
    "filter[details]": "true",
    limit: 5,
  })
  const row = (res.data ?? []).find((s) => s.id === target.offerId) ?? res.data?.[0]
  const before = Number(row?.quantity ?? 0)
  const reserve = Number(row?.reserve ?? 0)
  const warehouses = row?.warehouse ?? []
  // The warehouse holding the spool; else the one written to last; else the only one there is.
  const r = await redis()
  const holding = [...warehouses].sort((a, b) => Number(b.quantity ?? 0) - Number(a.quantity ?? 0))[0]
  const warehouseId =
    (holding && Number(holding.quantity ?? 0) > 0 ? holding.id : null) ??
    (Number(await r.get(KEY_WAREHOUSE)) || null) ??
    (warehouses.length === 1 ? warehouses[0].id : null)
  if (!warehouseId) return `❌ <b>${esc(target.sku)}</b>: не знаю, на якому складі бобіна — її залишок ніде не записаний`
  // What the other warehouses hold stays: the spool's total becomes the weight.
  const elsewhere = warehouses.filter((w) => w.id !== warehouseId).reduce((sum, w) => sum + Number(w.quantity ?? 0), 0)
  const quantity = Math.max(0, grams - elsewhere)

  await keycrmSend("PUT", "/offers/stocks", { warehouse_id: warehouseId, stocks: [{ id: target.offerId, quantity }] })
  await r.set(KEY_WAREHOUSE, String(warehouseId))
  // The site at once; KeyCRM's webhook confirms it a moment later.
  await applyStockUpdates([{ sku: target.sku, offerId: target.offerId, inStock: grams, inReserve: reserve }])
  changed.push(target.sku)
  const entry: Weighing = { at: new Date().toISOString(), by, sku: target.sku, before, after: grams }
  await r.multi().lPush(KEY_LOG, JSON.stringify(entry)).lTrim(KEY_LOG, 0, 199).exec()

  const diff = grams - before
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±"
  const fmt = (n: number) => n.toLocaleString("uk-UA", { maximumFractionDigits: 1 })
  const mark = Math.abs(diff) > BIG_CHANGE ? "⚠️" : "✅"
  const note = [
    `${mark} <b>${esc(target.sku)}</b>: було ${fmt(before)} г → стало ${fmt(grams)} г (${sign}${fmt(Math.abs(diff))} г)`,
    reserve > 0 ? `   у резерві ${fmt(reserve)} г, доступно ${fmt(Math.max(0, grams - reserve))} г` : "",
    mark === "⚠️" ? "   велика різниця — перевірте, чи правильна цифра" : "",
  ]
  return note.filter(Boolean).join("\n")
}
