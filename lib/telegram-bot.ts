// Server-only: the bot's private chats. People choose rubrics
// (lib/telegram-rubrics.ts) and get the daily update of those rubrics only
// (lib/telegram-news.ts). The channel's posts link here with
// t.me/<bot>?start=<rubric>, which subscribes to that rubric at once.
//
// Telegram calls app/api/telegram/webhook; `ensureWebhook` points it there
// from the production cron, so a new domain or token needs no manual step.
//
// Redis keys:
//   tg:subs  hash  chat id -> JSON list of rubric keys
//   tg:me:<bot id>  JSON  the bot's getMe, cached for a day (per bot, so a new token never shows the old name)

import { redis } from "@/lib/redis"
import { SITE_URL, TELEGRAM_URL } from "@/lib/site"
import { RUBRICS, rubricByKey } from "@/lib/telegram-rubrics"
import { type InlineButton, TelegramError, esc, keyboard, telegramChannel, tg, webhookSecret } from "@/lib/telegram"
import { handleChannelPost, noteChannelMember } from "@/lib/telegram-photos"

const KEY_SUBS = "tg:subs"
/** The bot id is the token's part before the colon. */
const keyMe = () => `tg:me:${(process.env.TELEGRAM_BOT_TOKEN ?? "").split(":")[0]}`

export const WEBHOOK_PATH = "/api/telegram/webhook"
// Channel posts: product photos (lib/telegram-photos.ts).
const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member", "channel_post", "edited_channel_post"]

// ---------------------------------------------------------------------------
// Subscribers

export async function readSubscribers(): Promise<[string, string[]][]> {
  const raw = await (await redis()).hGetAll(KEY_SUBS)
  return Object.entries(raw)
    .map(([chatId, json]) => [chatId, JSON.parse(json) as string[]] as [string, string[]])
    .filter(([, rubrics]) => rubrics.length > 0)
}

async function readRubrics(chatId: number | string): Promise<string[]> {
  const json = await (await redis()).hGet(KEY_SUBS, String(chatId))
  return json ? JSON.parse(json) : []
}

async function writeRubrics(chatId: number | string, rubrics: string[]): Promise<void> {
  const r = await redis()
  // Kept in RUBRICS order, unknown keys dropped.
  const clean = RUBRICS.map((x) => x.key).filter((k) => rubrics.includes(k))
  if (clean.length) await r.hSet(KEY_SUBS, String(chatId), JSON.stringify(clean))
  else await r.hDel(KEY_SUBS, String(chatId))
}

export async function removeSubscriber(chatId: number | string): Promise<void> {
  await (await redis()).hDel(KEY_SUBS, String(chatId))
}

/** Subscribers in all, and per rubric key. */
export async function subscriberCounts(): Promise<{ total: number; byRubric: Record<string, number> }> {
  const subs = await readSubscribers()
  const byRubric: Record<string, number> = {}
  for (const [, rubrics] of subs) for (const k of rubrics) byRubric[k] = (byRubric[k] ?? 0) + 1
  return { total: subs.length, byRubric }
}

// ---------------------------------------------------------------------------
// The bot itself

export async function botMe(): Promise<{ id: number; username: string; first_name: string }> {
  const r = await redis()
  const cached = await r.get(keyMe())
  if (cached) return JSON.parse(cached)
  const me = await tg("getMe")
  await r.set(keyMe(), JSON.stringify(me), { EX: 24 * 3600 })
  return me
}

export async function botUsername(): Promise<string> {
  return (await botMe()).username
}

/** Points Telegram's webhook at this deployment, and sets the bot's menu, when it isn't already. */
export async function ensureWebhook(): Promise<{ url: string; changed: boolean }> {
  const url = `${SITE_URL}${WEBHOOK_PATH}`
  const info = await tg<{ url: string; allowed_updates?: string[] }>("getWebhookInfo")
  const updatesSet = ALLOWED_UPDATES.every((u) => info.allowed_updates?.includes(u))
  if (info.url === url && updatesSet) return { url, changed: false }
  await tg("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ALLOWED_UPDATES })
  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Обрати рубрики новинок" },
      { command: "stop", description: "Відписатися від усіх" },
    ],
  })
  await tg("setMyShortDescription", {
    short_description: "Нові кольори пряжі SINCERITA за рубриками: меринос, кашемір, мохер та інші. Раз на день.",
  }).catch(() => {})
  await tg("setMyDescription", {
    description:
      "Бот новинок SINCERITA — італійської пряжі преміум якості.\n\nОберіть рубрики (меринос, кашемір, мохер, акції…), і раз на день я надсилатиму лише їхні нові кольори та акції, з посиланням, щоб купити в один дотик.",
  }).catch(() => {})
  return { url, changed: true }
}

const WELCOME =
  "Привіт! Я бот новинок <b>SINCERITA</b> 🧶\n\n" +
  "Оберіть рубрики нижче, і раз на день я надсилатиму лише їхні нові кольори та акції. " +
  "Кожен колір — з посиланням, щоб купити в один дотик.\n\n" +
  `Усі новинки разом — у каналі <a href="${TELEGRAM_URL}">${esc(telegramChannel())}</a>.`

function menuText(rubrics: string[]): string {
  if (rubrics.length === 0) return `${WELCOME}\n\nЗараз ви не підписані на жодну рубрику.`
  const titles = rubrics.map((k) => rubricByKey(k)?.title).filter(Boolean)
  return `${WELCOME}\n\n✅ Ваші рубрики: <b>${esc(titles.join(", "))}</b>`
}

function menuKeyboard(rubrics: string[]) {
  const toggles: InlineButton[] = RUBRICS.map((r) => ({
    text: `${rubrics.includes(r.key) ? "✅" : "▫️"} ${r.title}`,
    callback_data: `t:${r.key}`,
  }))
  const rows: InlineButton[][] = []
  for (let i = 0; i < toggles.length; i += 2) rows.push(toggles.slice(i, i + 2))
  rows.push([
    { text: "Усі рубрики", callback_data: "all" },
    { text: "Відписатися", callback_data: "none" },
  ])
  rows.push([{ text: "🛍 Перейти на сайт", url: `${SITE_URL}/?utm_source=telegram&utm_medium=bot&utm_campaign=menu` }])
  return keyboard(rows)
}

async function sendMenu(chatId: number, rubrics: string[], note?: string) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: note ? `${note}\n\n${menuText(rubrics)}` : menuText(rubrics),
    parse_mode: "HTML",
    reply_markup: menuKeyboard(rubrics),
    link_preview_options: { is_disabled: true },
  })
}

/** Handles one update from Telegram's webhook. */
export async function handleUpdate(update: any): Promise<void> {
  if (update.channel_post || update.edited_channel_post) {
    await handleChannelPost(update.channel_post ?? update.edited_channel_post, Boolean(update.edited_channel_post))
    return
  }
  const message = update.message
  if (message?.chat?.type === "private") {
    const chatId: number = message.chat.id
    const text = String(message.text ?? "").trim()
    const current = await readRubrics(chatId)

    if (text.startsWith("/start")) {
      // t.me/<bot>?start=<rubric> from a channel post, or «all».
      const payload = text.split(/\s+/)[1] ?? ""
      if (payload === "all") {
        const all = RUBRICS.map((r) => r.key)
        await writeRubrics(chatId, all)
        return sendMenu(chatId, all, "🔔 Ви підписані на всі рубрики.")
      }
      const rubric = rubricByKey(payload)
      if (rubric) {
        const next = current.includes(rubric.key) ? current : [...current, rubric.key]
        await writeRubrics(chatId, next)
        return sendMenu(chatId, next, `🔔 Ви підписані на «${esc(rubric.title)}».`)
      }
      return sendMenu(chatId, current)
    }
    if (text.startsWith("/stop")) {
      await writeRubrics(chatId, [])
      return sendMenu(chatId, [], "Ви відписалися від усіх рубрик. Повернутися можна будь-коли кнопками нижче.")
    }
    return sendMenu(
      chatId,
      current,
      "Я лише надсилаю новинки 🙂 Щоб спитати про пряжу чи замовлення, напишіть менеджеру в Instagram або зателефонуйте — контакти на сайті.",
    )
  }

  const cq = update.callback_query
  if (cq?.message?.chat?.type === "private") {
    const chatId: number = cq.message.chat.id
    const data = String(cq.data ?? "")
    const current = await readRubrics(chatId)
    let next = current
    let note = ""
    if (data === "all") {
      next = RUBRICS.map((r) => r.key)
      note = "Підписано на всі рубрики"
    } else if (data === "none") {
      next = []
      note = "Ви відписалися від усіх рубрик"
    } else if (data.startsWith("t:")) {
      const rubric = rubricByKey(data.slice(2))
      if (rubric) {
        const on = current.includes(rubric.key)
        next = on ? current.filter((k) => k !== rubric.key) : [...current, rubric.key]
        note = on ? `«${rubric.title}» вимкнено` : `«${rubric.title}» увімкнено`
      }
    }
    await writeRubrics(chatId, next)
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: note }).catch(() => {})
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: cq.message.message_id,
      text: menuText(next),
      parse_mode: "HTML",
      reply_markup: menuKeyboard(next),
      link_preview_options: { is_disabled: true },
    }).catch((e) => {
      // «message is not modified» when the same button is pressed twice.
      if (!(e instanceof TelegramError && /not modified/i.test(e.description))) throw e
    })
    return
  }

  // Blocked the bot: stop sending.
  const member = update.my_chat_member
  await noteChannelMember(member)
  if (member?.chat?.type === "private" && member.new_chat_member?.status === "kicked") {
    await removeSubscriber(member.chat.id)
  }
}

/** For the admin page: what Telegram says about the bot, the channel and the webhook. */
export async function botStatus() {
  const me = await botMe()
  const channel = telegramChannel()
  const [member, members, webhook] = await Promise.all([
    tg("getChatMember", { chat_id: channel, user_id: me.id }).catch((e: Error) => ({ status: `помилка: ${e.message}` })),
    tg<number>("getChatMemberCount", { chat_id: channel }).catch(() => null),
    tg("getWebhookInfo").catch((e: Error) => ({ error: e.message })),
  ])
  return {
    username: me.username,
    channel,
    /** "administrator" with can_post_messages is what posting needs. */
    channelStatus: String(member.status),
    canPost: member.status === "creator" || (member.status === "administrator" && member.can_post_messages !== false),
    channelMembers: members,
    webhookUrl: webhook.url as string | undefined,
    webhookError: (webhook.last_error_message ?? webhook.error) as string | undefined,
    webhookPending: webhook.pending_update_count as number | undefined,
  }
}
