// Server-only KeyCRM OpenAPI client. The API key is read from the environment
// and never sent to the browser. KeyCRM allows 60 requests per minute per key,
// so every call goes through a sliding-window limiter; reads also retry on 5xx.

const KEYCRM_URL = process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1"
const PAGE_LIMIT = 50
/** Stay a little under KeyCRM's 60 requests/minute. */
const MAX_PER_MINUTE = 55

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

const sentAt: number[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function throttle() {
  for (;;) {
    const now = Date.now()
    while (sentAt.length && now - sentAt[0] >= 60_000) sentAt.shift()
    if (sentAt.length < MAX_PER_MINUTE) {
      sentAt.push(now)
      return
    }
    await sleep(60_000 - (now - sentAt[0]) + 50)
  }
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
  for (let attempt = 1; ; attempt++) {
    await throttle()
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
    if (res.ok) return (await res.json()) as T
    const retryable = res.status === 429 || (method === "GET" && res.status >= 500)
    if (!retryable || attempt >= 4) {
      const text = await res.text().catch(() => "")
      throw new KeycrmError(`KeyCRM ${method} ${path}: HTTP ${res.status}`, res.status, text.slice(0, 2000))
    }
    const retryAfter = Number(res.headers.get("retry-after"))
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1))
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
