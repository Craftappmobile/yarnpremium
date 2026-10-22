// Server-only: which place on the site brings people to the Telegram channel.
//
// Each «Підписатися» button on the site (components/shop/telegram-button.tsx)
// opens /kanal/<place> (app/kanal/[place]), which counts the click and sends
// the visitor on to that place's own invite link to the channel, named after
// the place. The shop made them in the channel (INVITE_PLACES); a place
// without one gets a link the bot makes once (createChatInviteLink; the bot
// needs the channel's «Додавання підписників» right). Telegram tells the bot
// who joined by which link (chat_member updates), and who left: both are
// counted for the place. A link an administrator made comes cut short
// («https://t.me/+_oJmICtp…»), so it is matched by its name or its start.
// Without an invite link the button opens the channel's public address.
//
// Redis keys:
//   tg:invites            hash  place -> invite link the bot made
//   tg:invite:user:<id>   the place a channel member joined from (400 days), to count their leaving
//   tg:stats:<day>        clicks:p:<place>, joins:p:<place>, leaves:p:<place> (lib/telegram-stats.ts)

import { redis } from "@/lib/redis"
import { TELEGRAM_URL } from "@/lib/site"
import { countTelegram } from "@/lib/telegram-stats"
import { telegramChannel, telegramConfigured, tg } from "@/lib/telegram"

const KEY_INVITES = "tg:invites"
const USER_KEY = (id: number) => `tg:invite:user:${id}`
const USER_TTL = 400 * 86400

/** The site's buttons to the channel: their invite links' names, and the links the shop made. */
export const INVITE_PLACES: Record<"catalog" | "sold-out" | "order", { name: string; link?: string }> = {
  catalog: { name: "Сайт: каталог", link: "https://t.me/+_oJmICtp84BlNDU6" },
  "sold-out": { name: "Сайт: розпродано", link: "https://t.me/+9ll0fWk-IppjYjY6" },
  order: { name: "Сайт: після замовлення", link: "https://t.me/+hBl8XSyOyZJjMzUy" },
}
export type InvitePlace = keyof typeof INVITE_PLACES

export const isInvitePlace = (p: string): p is InvitePlace => Object.hasOwn(INVITE_PLACES, p)

/** The place's invite link, made the first time it's asked for; the channel's public address if it can't be. */
export async function inviteLink(place: InvitePlace): Promise<string> {
  const own = INVITE_PLACES[place].link
  if (own) return own
  if (!telegramConfigured()) return TELEGRAM_URL
  try {
    const r = await redis()
    const saved = await r.hGet(KEY_INVITES, place)
    if (saved) return saved
    const link = await tg<{ invite_link: string }>("createChatInviteLink", {
      chat_id: telegramChannel(),
      name: INVITE_PLACES[place].name,
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
  return (Object.keys(INVITE_PLACES) as InvitePlace[]).map((place) => ({
    place,
    name: INVITE_PLACES[place].name,
    link: INVITE_PLACES[place].link ?? saved[place] ?? null,
  }))
}

const IN = ["member", "administrator", "creator", "restricted"]
const OUT = ["left", "kicked"]

const isChannel = (chat: any) =>
  String(chat?.id) === telegramChannel() || (chat?.username && `@${String(chat.username).toLowerCase()}` === telegramChannel().toLowerCase())

/** The place an invite link Telegram reports is for: by its name, or by the link (cut short at «…» if an administrator made it). */
async function placeOf(invite: any): Promise<InvitePlace | null> {
  if (!invite) return null
  const places = Object.keys(INVITE_PLACES) as InvitePlace[]
  const byName = places.find((p) => INVITE_PLACES[p].name === invite.name)
  if (byName) return byName
  const link = String(invite.invite_link ?? "")
  if (!link) return null
  const start = link.replace(/…$/, "")
  const saved = await (await redis()).hGetAll(KEY_INVITES)
  const matches = (l?: string) => Boolean(l) && (link.endsWith("…") ? l!.startsWith(start) : l === link)
  return places.find((p) => matches(INVITE_PLACES[p].link) || matches(saved[p])) ?? null
}

/** A chat_member update: someone joined or left the channel. */
export async function handleChannelMember(update: any): Promise<void> {
  if (!isChannel(update.chat)) return
  const userId = Number(update.new_chat_member?.user?.id)
  if (!userId) return
  const was = String(update.old_chat_member?.status ?? "")
  const now = String(update.new_chat_member?.status ?? "")
  const r = await redis()
  if (OUT.includes(was) && IN.includes(now)) {
    const place = await placeOf(update.invite_link)
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
