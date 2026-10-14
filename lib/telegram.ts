// Server-only: the shop's Telegram bot (Bot API over HTTPS).
//
// Settings: TELEGRAM_BOT_TOKEN from @BotFather. TELEGRAM_CHANNEL is where the
// daily posts go, "@yarnpremium" unless set; the bot must be an administrator
// there with the right to post.

import { createHash } from "node:crypto"

export const DEFAULT_CHANNEL = "@yarnpremium"

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN)
}

export function telegramChannel(): string {
  return process.env.TELEGRAM_CHANNEL?.trim() || DEFAULT_CHANNEL
}

/**
 * The secret Telegram sends with every webhook call
 * (X-Telegram-Bot-Api-Secret-Token), worked out from the token so there is no
 * second setting to keep in step.
 */
export function webhookSecret(): string {
  return createHash("sha256").update(`webhook:${process.env.TELEGRAM_BOT_TOKEN ?? ""}`).digest("hex").slice(0, 48)
}

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${method}: ${code} ${description}`)
  }
}

/** A file sent with the call itself (multipart), not by URL or file id. */
export interface Upload {
  field: string
  data: Buffer
  name: string
  type: string
}

/** Calls a Bot API method; one retry when Telegram asks to slow down. */
export async function tg<T = any>(method: string, params: Record<string, unknown> = {}, upload?: Upload): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let payload: string | FormData = JSON.stringify(params)
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (upload) {
      // Multipart: objects (reply_markup) go as JSON strings.
      const form = new FormData()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v))
      }
      form.append(upload.field, new Blob([new Uint8Array(upload.data)], { type: upload.type }), upload.name)
      payload = form
      delete headers["Content-Type"]
    }
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(60_000),
    })
    const body = (await res.json().catch(() => null)) as {
      ok: boolean
      result?: T
      error_code?: number
      description?: string
      parameters?: { retry_after?: number }
    } | null
    if (body?.ok) return body.result as T
    const retryAfter = body?.parameters?.retry_after
    if (retryAfter && retryAfter <= 30 && attempt === 0) {
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      continue
    }
    throw new TelegramError(method, body?.error_code ?? res.status, body?.description ?? res.statusText, retryAfter)
  }
}

/** Text for parse_mode HTML. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export interface InlineButton {
  text: string
  url?: string
  callback_data?: string
  /**
   * The button's colour: green (success), blue (primary) or red (danger).
   * Apps too old to know it draw the usual button, so the text carries an emoji as well.
   */
  style?: "success" | "primary" | "danger"
}

export const keyboard = (rows: InlineButton[][]) => ({ inline_keyboard: rows })
