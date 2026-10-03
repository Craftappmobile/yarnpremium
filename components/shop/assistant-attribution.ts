import { readStorage, writeStorage } from "@/lib/storage"

// Remembers that this visitor talked to the shopping assistant, so the order
// they place within a week is marked in KeyCRM and in the shop's statistics.
// Cleared once that order is placed.

const KEY = "sinserita:assistant:attribution"
const KEEP_MS = 7 * 86400_000

export interface AssistantAttribution {
  /** Messages the visitor wrote to the assistant. */
  messages: number
  /** Products added to the cart from the assistant's cards. */
  skus: string[]
}

interface Saved extends AssistantAttribution {
  last: number
}

function read(): Saved | null {
  const s = readStorage(KEY) as Saved | null
  if (!s || typeof s.last !== "number" || Date.now() - s.last > KEEP_MS) return null
  return {
    last: s.last,
    messages: typeof s.messages === "number" ? s.messages : 0,
    skus: Array.isArray(s.skus) ? s.skus.filter((x): x is string => typeof x === "string") : [],
  }
}

function update(change: (s: Saved) => void) {
  const s = read() ?? { last: 0, messages: 0, skus: [] }
  change(s)
  s.last = Date.now()
  writeStorage(KEY, s)
}

/** Returns the message's number in this visitor's use of the assistant. */
export function noteAssistantMessage(): number {
  let n = 0
  update((s) => {
    n = ++s.messages
  })
  return n
}

export function noteAssistantAdd(sku: string) {
  update((s) => {
    if (!s.skus.includes(sku)) s.skus = [...s.skus, sku].slice(-50)
  })
}

/** What to send with the order, or undefined when the visitor didn't write to the assistant. */
export function readAssistantAttribution(): AssistantAttribution | undefined {
  const s = read()
  return s && s.messages > 0 ? { messages: s.messages, skus: s.skus } : undefined
}

export function clearAssistantAttribution() {
  writeStorage(KEY, null)
}
