// Conversations and limits of the shopping assistant, kept in Redis.
//
// The history lives on the server, not in the browser: the model sees exactly
// what it said and what the tools returned (a page can't slip in a forged
// assistant turn or tool result), and it only ever grows, which the model's
// thinking blocks require.
//
// Redis keys:
//   assistant:conv:<id>          JSON  { messages, turns, cartKey, productKey }  (expires a day after the last message)
//   assistant:lock:<id>          lock  held while a reply is generated
//   assistant:ip:<ip>:<hour>     count user messages from one address in an hour
//   assistant:day:<YYYY-MM-DD>   count user messages on the whole site in a day

import type Anthropic from "@anthropic-ai/sdk"
import { redis } from "@/lib/redis"

const CONV_TTL = 24 * 3600
const LOCK_TTL = 120

/** Messages one buyer may send per conversation, per hour, and all buyers per day. */
export const LIMITS = {
  turnsPerConversation: 40,
  perIpPerHour: 30,
  perDay: Number(process.env.ASSISTANT_DAILY_LIMIT) || 1000,
}

export interface Conversation {
  messages: Anthropic.Beta.BetaMessageParam[]
  turns: number
  /** The cart last described to the model, so it is mentioned again only when it changes. */
  cartKey: string
  /** The product page the buyer last wrote from, mentioned again only when they move to another. */
  productKey?: string
}

const convKey = (id: string) => `assistant:conv:${id}`

export const isConversationId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)

export async function loadConversation(id: string): Promise<Conversation | null> {
  const raw = await (await redis()).get(convKey(id))
  return raw ? (JSON.parse(raw) as Conversation) : null
}

export async function saveConversation(id: string, conv: Conversation): Promise<void> {
  await (await redis()).set(convKey(id), JSON.stringify(conv), { EX: CONV_TTL })
}

/** One reply at a time per conversation; returns a release function, or null when busy. */
export async function lockConversation(id: string): Promise<(() => Promise<void>) | null> {
  const r = await redis()
  const token = String(Math.random())
  if (!(await r.set(`assistant:lock:${id}`, token, { NX: true, EX: LOCK_TTL }))) return null
  return async () => {
    if ((await r.get(`assistant:lock:${id}`)) === token) await r.del(`assistant:lock:${id}`)
  }
}

async function bump(key: string, ttl: number): Promise<number> {
  const r = await redis()
  const n = await r.incr(key)
  if (n === 1) await r.expire(key, ttl)
  return n
}

/** Counts this message; returns the reason to refuse it when a limit is reached. */
export async function checkLimits(ip: string): Promise<string | null> {
  const now = new Date()
  const hour = now.toISOString().slice(0, 13)
  const day = now.toISOString().slice(0, 10)
  if ((await bump(`assistant:ip:${ip}:${hour}`, 3600)) > LIMITS.perIpPerHour) {
    return "Забагато повідомлень за годину. Спробуйте трохи пізніше або зателефонуйте нам."
  }
  if ((await bump(`assistant:day:${day}`, 2 * 86400)) > LIMITS.perDay) {
    return "Консультант зараз недоступний. Зателефонуйте нам, будь ласка."
  }
  return null
}
