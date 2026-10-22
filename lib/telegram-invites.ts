// Server-only: which place on the site brings people to the Telegram channel.
//
// Each «Підписатися» button on the site (components/shop/telegram-button.tsx)
// opens /kanal/<place> (app/kanal/[place]), which counts the click and sends
// the visitor on to that place's own invite link to the channel, made by the
// bot once (createChatInviteLink; the bot needs the channel's «Додавання
// підписників» right) and named after the place, so the channel's own list of
// invite links shows it too. Telegram tells the bot who joined by which link
// (chat_member updates), and who left: both are counted for the place.
// Without an invite link the button opens the channel's public address, as
// before.
//
// Redis keys:
//   tg:invites            hash  place -> invite link
//   tg:invite:user:<id>   the place a channel member joined from (400 days), to count their leaving
//   tg:stats:<day>        clicks:p:<place>, joins:p:<place>, leaves:p:<place> (lib/telegram-stats.ts)

import { redis } from "@/lib/redis"
import { TELEGRAM_URL } from "@/lib/site"
import { countTelegram } from "@/lib/telegram-stats"
import { telegramChannel, telegramConfigured, tg } from "@/lib/telegram"

const KEY_INVITES = "tg:invites"
const USER_KEY = (id: number) => `tg:invite:user:${id}`
const USER_TTL = 400 * 86400

/** The site's buttons to the channel, and their invite links' names. */
export const INVITE_PLACES = {
  catalog: "Сайт: каталог",
  "sold-out": "Сайт: розпродано",
  order: "Сайт: після замовлення",
} as const
export type InvitePlace = keyof typeof INVITE_PLACES

export const isInvitePlace = (p: string): p is InvitePlace => Object.hasOwn(INVITE_PLACES, p)

/** The place's invite link, made the first time it's asked for; the channel's public address if it can't be. */
export async function inviteLink(place: InvitePlace): Promise<string> {
  if (!telegramConfigured()) return TELEGRAM_URL
  try {
    const r = await redis()
    const saved = await r.hGet(KEY_INVITES, place)
    if (saved) return saved
    const link = await tg<{ invite_link: string }>("createChatInviteLink", {
      chat_id: telegramChannel(),
      name: INVITE_PLACES[place],
    })
    // Two first clicks at once: the first link saved is the one kept.
    if (await r.hSetNX(KEY_INVITES, place, link.invite_link)) return link.invite_link
    return (await r.hGet(KEY_INVITES, place)) ?? link.invite_link
  } catch (e) {
    console.error("[telegram invites]", place, (e as Error).message)
    return TELEGRAM_URL
  }
}

/** For the admin page: the places and their invite links (null: not made yet). */
export async function readInviteLinks(): Promise<{ place: InvitePlace; name: string; link: string | null }[]> {
  const saved = await (await redis()).hGetAll(KEY_INVITES)
  return (Object.keys(INVITE_PLACES) as InvitePlace[]).map((place) => ({ place, name: INVITE_PLACES[place], link: saved[place] ?? null }))
}

const IN = ["member", "administrator", "creator", "restricted"]
const OUT = ["left", "kicked"]

const isChannel = (chat: any) =>
  String(chat?.id) === telegramChannel() || (chat?.username && `@${String(chat.username).toLowerCase()}` === telegramChannel().toLowerCase())

/** A chat_member update: someone joined or left the channel. */
export async function handleChannelMember(update: any): Promise<void> {
  if (!isChannel(update.chat)) return
  const userId = Number(update.new_chat_member?.user?.id)
  if (!userId) return
  const was = String(update.old_chat_member?.status ?? "")
  const now = String(update.new_chat_member?.status ?? "")
  const r = await redis()
  if (OUT.includes(was) && IN.includes(now)) {
    const link = String(update.invite_link?.invite_link ?? "")
    if (!link) return
    const saved = await r.hGetAll(KEY_INVITES)
    const place = Object.entries(saved).find(([, l]) => l === link)?.[0]
    if (!place) return
    await r.set(USER_KEY(userId), place, { EX: USER_TTL })
    await countTelegram({ [`joins:p:${place}`]: 1 })
  } else if (IN.includes(was) && OUT.includes(now)) {
    const place = await r.get(USER_KEY(userId))
    if (!place) return
    await r.del(USER_KEY(userId))
    await countTelegram({ [`leaves:p:${place}`]: 1 })
  }
}
