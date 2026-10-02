// What /api/assistant streams back, one JSON object per line.

import type { Product } from "@/components/shop/data"

/** Product cards for the chat, each with the quantity offered for the cart. */
export type ProductsEvent = { type: "products"; items: { product: Product; quantity: number }[] }

export type AssistantEvent =
  | { type: "conversation"; id: string }
  /** What the assistant is doing while a tool runs. */
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  /** The model was swapped mid-reply (refusal fallback): drop the reply text shown so far. */
  | { type: "reset" }
  | ProductsEvent
  | { type: "error"; message: string }
  | { type: "done" }
