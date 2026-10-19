import { type NextRequest, NextResponse } from "next/server"
import { telegramConfigured, webhookSecret } from "@/lib/telegram"
import { handleUpdate } from "@/lib/telegram-bot"

// Telegram's calls for the bot's private chats (lib/telegram-bot.ts). Telegram
// sends the secret set with the webhook in a header; anything without it is
// turned away.
export const dynamic = "force-dynamic"
// Product photos from the photo channel are uploaded to KeyCRM after the answer (lib/telegram-photos.ts).
export const maxDuration = 300

export async function POST(req: NextRequest) {
  if (!telegramConfigured() || req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const update = await req.json().catch(() => null)
  try {
    if (update) await handleUpdate(update)
  } catch (e) {
    // Answer 200 anyway: Telegram would otherwise resend the same update again and again.
    console.error("[telegram-webhook]", (e as Error).message, JSON.stringify(update).slice(0, 500))
  }
  return NextResponse.json({ ok: true })
}
