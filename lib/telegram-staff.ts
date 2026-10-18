// Server-only: the shop's own Telegram group, where the bot reports each
// abandoned checkout (lib/checkout-draft.ts) as it becomes a KeyCRM lead, in
// the topic («гілка») chosen for it, so a manager sees it at once.
//
// The messages carry buyers' names and phones, so they go only to the chat
// and topic where someone wrote «/abandoned_here <code>»; the code is on the
// admin page (/admin/telegram), so a stranger who adds the bot to their own
// group can't divert them. «/abandoned_off <code>» stops them.
//
// Redis key: tg:staff:abandoned  JSON { chatId, threadId?, title, at }

import { createHash } from "node:crypto"
import { redis } from "@/lib/redis"
import { esc, telegramConfigured, tg } from "@/lib/telegram"

const KEY = "tg:staff:abandoned"

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

export async function readStaffChat(): Promise<StaffChat | null> {
  const raw = await (await redis()).get(KEY)
  return raw ? JSON.parse(raw) : null
}

/**
 * «/abandoned_here <code>» and «/abandoned_off <code>» in a group. Returns
 * true when the message was one of them (handled or refused), so nothing else
 * answers it.
 */
export async function handleStaffCommand(message: any): Promise<boolean> {
  const text = String(message.text ?? "").trim()
  const m = text.match(/^\/(abandoned_here|abandoned_off)(?:@\w+)?(?:\s+(\S+))?/)
  if (!m) return false
  const chatId: number = message.chat.id
  const threadId: number | undefined = message.is_topic_message ? message.message_thread_id : undefined
  const reply = (t: string) =>
    tg("sendMessage", { chat_id: chatId, ...(threadId ? { message_thread_id: threadId } : {}), text: t, parse_mode: "HTML" })
  if (m[2] !== staffCode()) {
    await reply("Потрібен код зі сторінки статистики Telegram на сайті: /abandoned_here КОД")
    return true
  }
  const r = await redis()
  if (m[1] === "abandoned_off") {
    await r.del(KEY)
    await reply("Сповіщення про кинуті кошики вимкнено.")
    return true
  }
  const topic = message.reply_to_message?.forum_topic_created?.name
  const title = [message.chat.title, topic].filter(Boolean).join(" → ") || String(chatId)
  const chat: StaffChat = { chatId, ...(threadId ? { threadId } : {}), title, at: new Date().toISOString() }
  await r.set(KEY, JSON.stringify(chat))
  await reply(
    "✅ Тут з'являтимуться кинуті кошики: щойно сайт створить угоду «Кинутий кошик» у KeyCRM (через годину після того, як людина ввела телефон і не замовила).",
  )
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
