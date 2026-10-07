// Server-only KeyCRM OpenAPI client. The API key is read from the environment
// and never sent to the browser. Reads retry on 5xx.
//
// Rate limit: KeyCRM's docs (docs.keycrm.app) say 20 requests per minute per
// key, yet the catalog sync has made ~110 requests in about a minute every 15
// minutes without a single 429, so what KeyCRM enforces today is higher, or
// allows bursts. Every call takes a slot in one sliding minute shared by all
// function instances (kept in Redis): MAX_PER_MINUTE in all, of which
// background jobs (keycrmBackground) may use BACKGROUND_PER_MINUTE, so an order
// or a payment never queues behind a catalog sync. The sync reports KeyCRM's
// rate-limit headers and any 429s, to see if KeyCRM tightens the limit.

import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID, timingSafeEqual } from "node:crypto"
import { redis, redisConfigured } from "@/lib/redis"

const KEYCRM_URL = process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1"
const PAGE_LIMIT = 50
/** Requests per sliding minute for the whole site: the rate the catalog sync has run at without a 429. */
const MAX_PER_MINUTE = 55
/** Crons leave the rest of the minute to buyers' orders and payments. */
const BACKGROUND_PER_MINUTE = 44
const WINDOW_MS = 60_000
/** Sorted set: one member per request sent in the last minute, scored by its time (ms). */
const KEY_SENT = "keycrm:sent"

/** The key as pasted into Vercel, minus stray whitespace, quotes or a "Bearer " prefix. */
function apiKey(): string {
  return (process.env.KEYCRM_API_KEY ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim()
}

export function keycrmConfigured(): boolean {
  return Boolean(apiKey())
}

/** Shape of the configured key, for diagnosing 401s without revealing it. */
export function keycrmKeyShape() {
  const raw = process.env.KEYCRM_API_KEY ?? ""
  return {
    rawLength: raw.length,
    cleanedLength: apiKey().length,
    hadWhitespace: /\s/.test(raw),
    hadQuotes: /["']/.test(raw),
    hadBearerPrefix: /^\s*["']?Bearer/i.test(raw),
    charset: /^[A-Za-z0-9+/=_-]+$/.test(apiKey()) ? "base64-like" : "other",
    // Characters outside the base64 alphabet (e.g. "|", or a Cyrillic look-alike), as code points.
    unusualChars: [...new Set(apiKey().replace(/[A-Za-z0-9+/=_-]/g, ""))].map(
      (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
    ),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What a background job used of KeyCRM. */
export interface KeycrmUsage {
  requests: number
  seconds: number
  /** Responses with HTTP 429 (each one retried). */
  rateLimited: number
  /** KeyCRM's rate-limit headers from its last response, if it sends any. */
  headers?: Record<string, string>
}

const backgroundJob = new AsyncLocalStorage<KeycrmUsage>()

/**
 * Runs a cron or another job nobody waits on: its KeyCRM calls get the smaller
 * share of the rate limit. Returns the job's result and what it used.
 */
export async function keycrmBackground<T>(job: () => Promise<T>): Promise<{ result: T; usage: KeycrmUsage }> {
  const usage: KeycrmUsage = { requests: 0, seconds: 0, rateLimited: 0 }
  const started = Date.now()
  const result = await backgroundJob.run(usage, job)
  usage.seconds = Math.round((Date.now() - started) / 1000)
  return { result, usage }
}

/**
 * Takes a slot if fewer than ARGV[1] requests went out in the last ARGV[2] ms;
 * else returns the ms until enough of them age out. Redis's clock, so instances agree.
 */
const TAKE_SLOT = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local sent = redis.call('ZCARD', KEYS[1])
if sent < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return 0
end
local freed = redis.call('ZRANGE', KEYS[1], sent - limit, sent - limit, 'WITHSCORES')
return math.max(1, freed[2] + window - now)
`

/** Fallback while Redis can't be reached: the same window, for this instance only. */
const sentAt: number[] = []
let sharedLimiterFailedAt = 0

function takeLocalSlot(limit: number): number {
  const now = Date.now()
  while (sentAt.length && now - sentAt[0] >= WINDOW_MS) sentAt.shift()
  if (sentAt.length < limit) {
    sentAt.push(now)
    return 0
  }
  return sentAt[sentAt.length - limit] + WINDOW_MS - now
}

async function takeSlot(limit: number): Promise<number> {
  if (redisConfigured() && Date.now() - sharedLimiterFailedAt > WINDOW_MS) {
    try {
      const r = await redis()
      const args = [String(limit), String(WINDOW_MS), randomUUID()]
      return Number(await r.eval(TAKE_SLOT, { keys: [KEY_SENT], arguments: args }))
    } catch (e) {
      sharedLimiterFailedAt = Date.now()
      console.error("[keycrm] shared rate limiter failed, limiting per instance:", (e as Error).message)
    }
  }
  return takeLocalSlot(limit)
}

async function throttle(limit: number) {
  for (let wait = await takeSlot(limit); wait > 0; wait = await takeSlot(limit)) await sleep(wait + 50)
}

/** Rate-limit headers of a KeyCRM response (X-RateLimit-*, Retry-After), if any. */
function rateLimitHeaders(headers: Headers): Record<string, string> | undefined {
  const found = [...headers].filter(([name]) => /ratelimit|retry-after/i.test(name))
  return found.length ? Object.fromEntries(found) : undefined
}

type Params = Record<string, string | number | boolean | undefined>

/** GET a KeyCRM endpoint and return the parsed JSON. Throws after retries are exhausted. */
export async function keycrmGet<T = any>(path: string, params: Params = {}): Promise<T> {
  const url = new URL(`${KEYCRM_URL}${path}`)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v))
  return request<T>("GET", url)
}

/**
 * POST/PUT to KeyCRM. Retried only on 429 (the request was not processed): a
 * retry after a 5xx or a timeout could create the same order twice.
 */
export async function keycrmSend<T = any>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
  return request<T>(method, new URL(`${KEYCRM_URL}${path}`), body)
}

export class KeycrmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: URL, body?: unknown): Promise<T> {
  const path = url.pathname.replace(/^\/v1/, "")
  const usage = backgroundJob.getStore()
  for (let attempt = 1; ; attempt++) {
    await throttle(usage ? BACKGROUND_PER_MINUTE : MAX_PER_MINUTE)
    if (usage) usage.requests++
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    })
    const limits = rateLimitHeaders(res.headers)
    if (usage && limits) usage.headers = limits
    if (res.status === 429) {
      if (usage) usage.rateLimited++
      console.warn(`[keycrm] ${method} ${path}: HTTP 429 (attempt ${attempt})`, JSON.stringify(limits ?? {}))
    }
    if (res.ok) return (await res.json()) as T
    const retryable = res.status === 429 || (method === "GET" && res.status >= 500)
    if (!retryable || attempt >= 4) {
      const text = await res.text().catch(() => "")
      throw new KeycrmError(`KeyCRM ${method} ${path}: HTTP ${res.status}`, res.status, text.slice(0, 2000))
    }
    const retryAfter = Number(res.headers.get("retry-after"))
    // A background job can afford to wait out KeyCRM's minute; a buyer can't.
    const backoff = res.status === 429 && usage ? 15_000 * attempt : 2000 * 2 ** (attempt - 1)
    await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff)
  }
}

/** Reads every page of a paginated KeyCRM list. A failed page fails the whole read. */
export async function keycrmGetAll<T = any>(path: string, params: Params = {}): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const res = await keycrmGet<{ data?: T[]; next_page_url?: string | null }>(path, {
      ...params,
      limit: PAGE_LIMIT,
      page,
    })
    const data = res.data ?? []
    items.push(...data)
    if (!res.next_page_url || data.length === 0) return items
  }
}

/** Reads up to `maxPages` pages of a list; `total` is KeyCRM's count for the whole list. */
export async function keycrmGetPages<T = any>(
  path: string,
  params: Params = {},
  maxPages = 1,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = []
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    const res = await keycrmGet<{ data?: T[]; total?: number; next_page_url?: string | null }>(path, {
      ...params,
      limit: PAGE_LIMIT,
      page,
    })
    total = res.total ?? total
    items.push(...(res.data ?? []))
    if (!res.next_page_url) break
  }
  return { items, total }
}

/**
 * KeyCRM doesn't sign webhooks: their URL carries a secret, ?token=<secret>,
 * by default KEYCRM_WEBHOOK_SECRET.
 */
export function webhookAuthorized(req: { nextUrl: URL }, secretVar = "KEYCRM_WEBHOOK_SECRET"): boolean {
  const secret = process.env[secretVar] ?? ""
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!secret || token.length !== secret.length) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret))
}
