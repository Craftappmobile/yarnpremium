import Anthropic from "@anthropic-ai/sdk"
import { type NextRequest, NextResponse } from "next/server"
import { formatQuantity } from "@/components/shop/data"
import { readProducts } from "@/lib/catalog"
import { redisConfigured } from "@/lib/redis"
import { SYSTEM_PROMPT } from "@/lib/assistant/prompt"
import {
  type Conversation,
  LIMITS,
  checkLimits,
  isConversationId,
  loadConversation,
  lockConversation,
  saveConversation,
} from "@/lib/assistant/session"
import type { AssistantEvent } from "@/lib/assistant/events"
import { countStats, usageCounters } from "@/lib/assistant/stats"
import { TOOLS, runTool, toolStatus } from "@/lib/assistant/tools"

// The shopping assistant: one buyer message in, the reply streamed back as
// newline-separated JSON events (lib/assistant/events.ts). The model reads the
// catalog through the tools in lib/assistant/tools.ts.

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MODEL = process.env.ASSISTANT_MODEL || "claude-sonnet-5-5"
/** Models that take `effort` and the server-side refusal fallback. */
const CURRENT_MODEL = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL)
const MESSAGE_MAX = 1000
/** Model calls per buyer message: a few tool rounds, then it must answer. */
const ROUNDS_MAX = 6

let client: Anthropic | null = null

function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown"
}

/** «У кошику: …» when the cart differs from the one the model last saw. */
async function cartNote(raw: unknown, conv: Conversation): Promise<string | null> {
  const lines = Array.isArray(raw)
    ? raw
        .filter((l): l is { sku: string; quantity: number } => typeof l?.sku === "string" && typeof l?.quantity === "number")
        .slice(0, 50)
    : []
  const key = lines.map((l) => `${l.sku}:${l.quantity}`).sort().join(",")
  if (key === conv.cartKey) return null
  conv.cartKey = key
  if (lines.length === 0) return "[Кошик покупця тепер порожній.]"
  const products = new Map((await readProducts(lines.map((l) => l.sku))).map((p) => [p.sku, p]))
  const known = lines.flatMap((l) => {
    const p = products.get(l.sku)
    return p ? [`${p.name} (артикул ${p.sku}) — ${formatQuantity(l.quantity, p.priceUnit)}`] : []
  })
  return known.length ? `[Зараз у кошику покупця: ${known.join("; ")}.]` : null
}

const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status })

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || !redisConfigured()) return fail("Консультант не налаштований.", 503)

  const body = await req.json().catch(() => ({}))
  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!message || message.length > MESSAGE_MAX) return fail(`Повідомлення має бути до ${MESSAGE_MAX} символів.`, 400)

  const limited = await checkLimits(clientIp(req))
  if (limited) {
    await countStats({ limited: 1 })
    return fail(limited, 429)
  }

  let id: string = isConversationId(body.conversationId) ? body.conversationId : crypto.randomUUID()
  let conv = await loadConversation(id)
  const isNew = !conv
  if (!conv) {
    // Unknown or expired: start afresh under a new id.
    id = crypto.randomUUID()
    conv = { messages: [], turns: 0, cartKey: "" }
  }
  if (conv.turns >= LIMITS.turnsPerConversation) return fail("Розмова вийшла задовгою — почніть нову, будь ласка.", 429)
  const release = await lockConversation(id)
  if (!release) return fail("Зачекайте, будь ласка, — консультант ще відповідає.", 409)

  const note = await cartNote(body.cart, conv).catch(() => null)
  const content: Anthropic.Beta.BetaTextBlockParam[] = note ? [{ type: "text", text: note }] : []
  content.push({ type: "text", text: message })
  const messages = [...conv.messages, { role: "user" as const, content }]

  client ??= new Anthropic()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistantEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
      // Usage and spend of this reply, recorded however it ends.
      const stats: Record<string, number> = { messages: 1 }
      const tally = (add: Record<string, number>) => {
        for (const [k, n] of Object.entries(add)) stats[k] = (stats[k] ?? 0) + n
      }
      send({ type: "conversation", id })
      try {
        for (let round = 0; ; round++) {
          const response = client!.beta.messages.stream({
            model: MODEL,
            max_tokens: 8000,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages,
            // Caches everything up to the last message, so each turn re-reads the conversation cheaply.
            cache_control: { type: "ephemeral" },
            ...(CURRENT_MODEL && {
              output_config: { effort: "low" as const },
              // A safety decline is retried on another model inside the same call.
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default" as const,
            }),
          })
          for await (const event of response) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "fallback") send({ type: "reset" })
              else if (event.content_block.type === "tool_use") send({ type: "status", text: toolStatus(event.content_block.name) })
            } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ type: "text", text: event.delta.text })
            }
          }
          const reply = await response.finalMessage()
          tally(usageCounters(reply.model, reply.usage))
          // Kept whole (thinking blocks included): the history must only ever grow.
          messages.push({ role: "assistant", content: reply.content })

          if (reply.stop_reason === "refusal") {
            tally({ refusals: 1 })
            send({ type: "text", text: "Вибачте, з цим я не допоможу. Запитайте, будь ласка, про пряжу чи замовлення." })
            break
          }
          const calls = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
          if (calls.length === 0) break
          if (reply.stop_reason === "max_tokens" || round + 1 >= ROUNDS_MAX) {
            throw new Error(`assistant stopped with tool calls pending (${reply.stop_reason}, round ${round})`)
          }
          const results = await Promise.all(
            calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
              const outcome = await runTool(call.name, call.input)
              if (outcome.event) send(outcome.event)
              if (outcome.event?.type === "products") tally({ products_shown: outcome.event.items.length })
              return { type: "tool_result", tool_use_id: call.id, content: outcome.content, is_error: outcome.isError }
            }),
          )
          messages.push({ role: "user", content: results })
        }
        conv!.messages = messages
        conv!.turns++
        await saveConversation(id, conv!)
        // Counted once saved: a first message that failed is retried as a new conversation.
        if (isNew) tally({ conversations: 1 })
        send({ type: "done" })
      } catch (e) {
        console.error("[assistant]", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e)
        tally({ errors: 1 })
        // The conversation isn't saved, so the buyer can simply ask again.
        send({ type: "error", message: "Не вдалося відповісти. Спробуйте ще раз або зателефонуйте нам." })
      } finally {
        await release().catch(() => {})
        await countStats(stats)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  })
}
