// Server-only: the shop's own Telegram group, where the bot reports each
// abandoned checkout (lib/checkout-draft.ts) as it becomes a KeyCRM lead, and
// each master-class order left unpaid on yarnmk.com.ua (lib/mk-unpaid.ts), in
// the topic («гілка») chosen for it, so a manager sees it at once. Sales in
// KeyCRM that break the rule for yarn by weight (lib/remnant-alerts.ts) go to
// a topic of their own.
//
// The messages carry buyers' names and phones, so they go only to the chat
// and topic where someone wrote «/abandoned_here <code>» (or «/remnants_here
// <code>»); the code is on the admin page (/admin/telegram), so a stranger who
// adds the bot to their own group can't divert them. «/abandoned_off <code>»
// («/remnants_off <code>») stops them.
//
// Redis keys: tg:staff:abandoned, tg:staff:remnants  JSON { chatId, threadId?, title, at }

import { createHash } from "node:crypto"
import { redis } from "@/lib/redis"
import { esc, telegramConfigured, tg } from "@/lib/telegram"

/** What each topic gets, and what the bot answers when it is set or switched off there. */
const TOPICS = {
  abandoned: {
    key: "tg:staff:abandoned",
    on: "✅ Тут з'являтимуться кинуті кошики: щойно сайт створить угоду «Кинутий кошик» у KeyCRM (через годину після того, як людина ввела телефон і не замовила).",
    off: "Сповіщення про кинуті кошики вимкнено.",
  },
  remnants: {
    key: "tg:staff:remnants",
    on: [
      "✅ Тут з'являтимуться продажі пряжі на вагу, що порушують правило:",
      "• менше 100 г (кашемір — 50 г) продаємо лише тоді, коли це весь залишок;",
      "• після продажу на складі лишається 0 або не менше 100 г (кашемір — 50 г).",
      "",
      "Перевіряю замовлення з усіх джерел кожні 15 хвилин, про кожне — один раз.",
    ].join("\n"),
    off: "Сповіщення про залишки вимкнено.",
  },
} as const

export type StaffTopic = keyof typeof TOPICS

export interface StaffChat {
  chatId: number
  /** The topic's id in a group with topics; none for a plain group. */
  threadId?: number
  /** Group and topic as Telegram names them, for the admin page. */
  title: string
  at: string
}

/** The code the commands need: worked out from the bot's token, shown on the admin page. */
export function staffCode(): string {
  return createHash("sha256").update(`staff:${process.env.TELEGRAM_BOT_TOKEN ?? ""}`).digest("hex").slice(0, 8)
}

export async function readStaffChat(topic: StaffTopic = "abandoned"): Promise<StaffChat | null> {
  const raw = await (await redis()).get(TOPICS[topic].key)
  return raw ? JSON.parse(raw) : null
}

/**
 * «/abandoned_here <code>», «/remnants_here <code>» and their «_off» in a
 * group. Returns true when the message was one of them (handled or refused),
 * so nothing else answers it.
 */
export async function handleStaffCommand(message: any): Promise<boolean> {
  const text = String(message.text ?? "").trim()
  const m = text.match(/^\/(abandoned|remnants)_(here|off)(?:@\w+)?(?:\s+(\S+))?/)
  if (!m) return false
  const kind = TOPICS[m[1] as StaffTopic]
  const chatId: number = message.chat.id
  const threadId: number | undefined = message.is_topic_message ? message.message_thread_id : undefined
  const reply = (t: string) =>
    tg("sendMessage", { chat_id: chatId, ...(threadId ? { message_thread_id: threadId } : {}), text: t, parse_mode: "HTML" })
  if (m[3] !== staffCode()) {
    await reply(`Потрібен код зі сторінки статистики Telegram на сайті: /${m[1]}_here КОД`)
    return true
  }
  const r = await redis()
  if (m[2] === "off") {
    await r.del(kind.key)
    await reply(kind.off)
    return true
  }
  const topic = message.reply_to_message?.forum_topic_created?.name
  const title = [message.chat.title, topic].filter(Boolean).join(" → ") || String(chatId)
  const chat: StaffChat = { chatId, ...(threadId ? { threadId } : {}), title, at: new Date().toISOString() }
  await r.set(kind.key, JSON.stringify(chat))
  await reply(kind.on)
  return true
}

export interface AbandonedNotice {
  name: string
  phone: string
  email: string
  value: number
  lines: string[]
  source: string
  assistantMessages: number
  pipeline: string | null
}

/** Reports an abandoned checkout to the staff group, if one is set up. Never throws. */
export async function notifyAbandoned(n: AbandonedNotice): Promise<void> {
  if (!telegramConfigured()) return
  try {
    const chat = await readStaffChat()
    if (!chat) return
    const text = [
      `🛒 <b>Кинутий кошик · ${n.value.toLocaleString("uk-UA")} ₴</b>`,
      "",
      `👤 ${esc(n.name || "без імені")}`,
      `📞 <code>${esc(n.phone)}</code>${n.email ? ` · ${esc(n.email)}` : ""}`,
      "",
      ...n.lines.map((l) => `• ${esc(l)}`),
      "",
      `Звідки: ${esc(n.source)}`,
      n.assistantMessages > 0 ? `Писала консультанту на сайті: ${n.assistantMessages} повід.` : "",
      `Угода в KeyCRM${n.pipeline ? `, воронка «${esc(n.pipeline)}»` : ""}. Напишіть у Viber.`,
    ]
      .filter((l, i, all) => l !== "" || all[i - 1] !== "")
      .join("\n")
    await tg("sendMessage", {
      chat_id: chat.chatId,
      ...(chat.threadId ? { message_thread_id: chat.threadId } : {}),
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
  } catch (e) {
    console.error("[abandoned] Telegram notice failed:", (e as Error).message)
  }
}

export interface UnpaidCourseNotice {
  total: number
  name: string
  email: string
  /** What the order was for, in words: «Майстер-клас «Светр Аліса» — 990 ₴». */
  items: string[]
  createdAt: string
}

/** A master-class order on yarnmk.com.ua left unpaid (lib/mk-unpaid.ts), to the same staff topic. Never throws. */
export async function notifyUnpaidCourse(n: UnpaidCourseNotice): Promise<void> {
  if (!telegramConfigured()) return
  try {
    const chat = await readStaffChat()
    if (!chat) return
    const at = new Date(n.createdAt).toLocaleString("uk-UA", { timeZone: "Europe/Kiev", dateStyle: "short", timeStyle: "short" })
    const text = [
      `💳 <b>Не оплатили на yarnmk.com.ua · ${n.total.toLocaleString("uk-UA")} ₴</b>`,
      "",
      `👤 ${esc(n.name || "без імені")}`,
      n.email ? `✉️ <code>${esc(n.email)}</code>` : "✉️ email невідомий",
      "",
      ...n.items.map((l) => `• ${esc(l)}`),
      "",
      `Замовлення ${esc(at)}, оплати немає вже годину. Напишіть на email.`,
    ].join("\n")
    await tg("sendMessage", {
      chat_id: chat.chatId,
      ...(chat.threadId ? { message_thread_id: chat.threadId } : {}),
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
  } catch (e) {
    console.error("[mk-unpaid] Telegram notice failed:", (e as Error).message)
  }
}

export interface RemnantNotice {
  /** KeyCRM order number. */
  order: number
  /** Where the order came from (its KeyCRM source), when known. */
  source?: string
  /** One per product, in words (lib/remnant-alerts.ts). */
  lines: string[]
}

/**
 * A KeyCRM order that broke the rule for yarn by weight (lib/remnant-alerts.ts),
 * to the remnants topic. Returns whether it was sent; never throws.
 */
export async function notifyRemnants(n: RemnantNotice): Promise<boolean> {
  if (!telegramConfigured()) return false
  try {
    const chat = await readStaffChat("remnants")
    if (!chat) return false
    const text = [
      `⚖️ <b>Замовлення №${n.order}</b>${n.source ? ` · ${esc(n.source)}` : ""}`,
      "",
      ...n.lines.map((l) => `• ${esc(l)}`),
      "",
      "Виправте замовлення в KeyCRM.",
    ].join("\n")
    await tg("sendMessage", {
      chat_id: chat.chatId,
      ...(chat.threadId ? { message_thread_id: chat.threadId } : {}),
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
    return true
  } catch (e) {
    console.error("[remnants] Telegram notice failed:", (e as Error).message)
    return false
  }
}
