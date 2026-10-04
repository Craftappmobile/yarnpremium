"use client"

import * as Dialog from "@radix-ui/react-dialog"
import Link from "next/link"
import { useEffect, useRef, useState, type FormEvent } from "react"
import ReactMarkdown from "react-markdown"
import { Check, Minus, Plus, RotateCcw, Send, X } from "lucide-react"
import type { AssistantEvent, ProductsEvent } from "@/lib/assistant/events"
import { SHOP_PHONE, SHOP_PHONE_HREF } from "@/lib/site"
import { readStorage, writeStorage } from "@/lib/storage"
import { type Product, formatPrice, formatQuantity, lineTotal, quantityRules, stepQuantity } from "./data"
import { useCart } from "./cart-context"
import { trackAssistant, trackAssistantContact } from "./analytics"
import { noteAssistantAdd, noteAssistantMessage } from "./assistant-attribution"
import { ProductImage } from "./product-image"
import { useReturnFocus } from "./use-return-focus"

// The shopping assistant's chat. The conversation itself is kept on the server
// (/api/assistant); this keeps what was shown, so the chat survives a reload.

const STORAGE_KEY = "sinserita:assistant:v1"
const KEEP_MESSAGES = 40
/** How additions from the chat's cards are labelled in analytics. */
const LIST_NAME = "Консультант"

type Part = { kind: "text"; text: string } | { kind: "products"; items: ProductsEvent["items"] }
type ChatMessage = { role: "user"; text: string } | { role: "assistant"; parts: Part[]; failed?: boolean }
interface Saved {
  id: string | null
  messages: ChatMessage[]
}

const SUGGESTIONS = [
  "Скільки пряжі потрібно на светр?",
  "Порадьте кашемір на шапку",
  "Що замінить пряжу з мого опису?",
]

/** The product page the chat was opened from. */
export interface AssistantProduct {
  sku: string
  name: string
}

/** Ready questions about the product the chat was opened from. */
const PRODUCT_SUGGESTIONS = [
  "Скільки треба на светр 48 розміру?",
  "Скільки треба на кардиган оверсайз?",
  "Скільки треба на шапку і шарф?",
  "У скільки ниток вʼязати і якими спицями?",
]

function readSaved(): Saved {
  const s = readStorage(STORAGE_KEY) as Saved | null
  return s && Array.isArray(s.messages) ? { id: typeof s.id === "string" ? s.id : null, messages: s.messages } : { id: null, messages: [] }
}

/** Applies one streamed event to the reply being built. */
function applyEvent(parts: Part[], event: AssistantEvent): Part[] {
  switch (event.type) {
    case "text": {
      const last = parts[parts.length - 1]
      return last?.kind === "text"
        ? [...parts.slice(0, -1), { kind: "text", text: last.text + event.text }]
        : [...parts, { kind: "text", text: event.text }]
    }
    case "products":
      return [...parts, { kind: "products", items: event.items }]
    case "reset":
      return parts.filter((p) => p.kind !== "text")
    default:
      return parts
  }
}

export function AssistantPanel({ onClose, product = null }: { onClose: () => void; product?: AssistantProduct | null }) {
  const { cart } = useCart()
  const [saved, setSaved] = useState<Saved>(readSaved)
  // Opened from a product page: its questions stay offered until the buyer writes.
  const [productChips, setProductChips] = useState(Boolean(product))
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const returnFocus = useReturnFocus()

  useEffect(() => {
    writeStorage(STORAGE_KEY, { ...saved, messages: saved.messages.slice(-KEEP_MESSAGES) })
  }, [saved])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [saved.messages, status])

  const updateReply = (update: (m: Extract<ChatMessage, { role: "assistant" }>) => Partial<ChatMessage>) =>
    setSaved((s) => {
      const last = s.messages[s.messages.length - 1]
      if (last?.role !== "assistant") return s
      return { ...s, messages: [...s.messages.slice(0, -1), { ...last, ...update(last) } as ChatMessage] }
    })

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    setDraft("")
    setProductChips(false)
    setBusy(true)
    trackAssistant("assistant_message", { message_number: noteAssistantMessage() })
    setStatus("Думаю…")
    setSaved((s) => ({
      ...s,
      messages: [...s.messages, { role: "user", text: message }, { role: "assistant", parts: [] }],
    }))
    const fail = (error: string) => updateReply((m) => ({ parts: [...m.parts, { kind: "text", text: error }], failed: true }))
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: saved.id,
          message,
          product: product?.sku,
          cart: cart.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        }),
      })
      if (!res.ok || !res.body) {
        const { error } = await res.json().catch(() => ({ error: null }))
        fail(error || "Не вдалося звʼязатися з консультантом. Спробуйте ще раз.")
        return
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as AssistantEvent
          if (event.type === "conversation") {
            if (event.id !== saved.id) trackAssistantContact(event.id)
            setSaved((s) => ({ ...s, id: event.id }))
          }
          else if (event.type === "status") setStatus(event.text)
          else if (event.type === "error") fail(event.message)
          else {
            if (event.type === "products") trackAssistant("assistant_products_shown", { count: event.items.length })
            if (event.type === "text" || event.type === "products") setStatus("")
            updateReply((m) => ({ parts: applyEvent(m.parts, event) }))
          }
        }
      }
    } catch {
      fail("Звʼязок перервався. Спробуйте ще раз.")
    } finally {
      setBusy(false)
      setStatus("")
      inputRef.current?.focus()
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    send(draft)
  }

  const restart = () => {
    setSaved({ id: null, messages: [] })
    inputRef.current?.focus()
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent" />
        <Dialog.Content
          aria-describedby={undefined}
          {...returnFocus}
          onOpenAutoFocus={(e) => {
            returnFocus.onOpenAutoFocus()
            e.preventDefault()
            inputRef.current?.focus()
          }}
          className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl sm:inset-auto sm:bottom-5 sm:right-4 sm:h-[min(640px,calc(100dvh-2.5rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-zinc-200 dark:bg-zinc-900 dark:sm:border-zinc-800"
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div>
              <Dialog.Title className="text-base font-medium">Консультант з пряжі</Dialog.Title>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Відповідає ШІ · ціни на картках актуальні</p>
            </div>
            <div className="flex items-center">
              {saved.messages.length > 0 && (
                <button
                  type="button"
                  onClick={restart}
                  disabled={busy}
                  className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
                  aria-label="Почати нову розмову"
                  title="Нова розмова"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full p-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label="Закрити консультанта"
                >
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
            {saved.messages.length === 0 && !product && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Вітаю! Допоможу підібрати пряжу, порахую, скільки її потрібно на ваш виріб, і підкажу щодо доставки та
                  оплати. Що вʼяжемо?
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-zinc-300 px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {saved.messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-900 px-3.5 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
                    {m.text}
                  </p>
                </div>
              ) : (
                <div key={i} className="space-y-3">
                  {m.parts.map((part, j) =>
                    part.kind === "text" ? (
                      <div
                        key={j}
                        className={`max-w-[95%] space-y-2 text-sm leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 ${m.failed ? "text-red-700 dark:text-red-400" : "text-zinc-800 dark:text-zinc-200"}`}
                      >
                        <ReactMarkdown
                          disallowedElements={["img"]}
                          components={{
                            a: ({ href, children }) =>
                              href?.startsWith("/") ? (
                                <Link href={href} className="underline">
                                  {children}
                                </Link>
                              ) : (
                                <>{children}</>
                              ),
                          }}
                        >
                          {part.text}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div key={j} className="space-y-2">
                        {part.items.map(({ product, quantity }) => (
                          <ProductCard key={product.sku} product={product} suggested={quantity} />
                        ))}
                      </div>
                    ),
                  )}
                </div>
              ),
            )}
            {status && <p className="animate-pulse text-sm text-zinc-500 dark:text-zinc-400">{status}</p>}
            {product && productChips && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Порахую, скільки <span className="font-medium text-zinc-900 dark:text-zinc-50">{product.name}</span>{" "}
                  потрібно на ваш виріб. Оберіть питання або напишіть своє: що вʼяжете, розмір, у скільки ниток.
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRODUCT_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-zinc-300 px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-zinc-800">
            {cart.length > 0 && (
              <Link
                href="/checkout"
                onClick={() => {
                  trackAssistant("assistant_checkout_click")
                  onClose()
                }}
                className="mb-2 block text-center text-sm font-medium text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
              >
                Оформити замовлення ({cart.length} {cart.length === 1 ? "товар" : "товари"} у кошику)
              </Link>
            )}
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <label htmlFor="assistant-input" className="sr-only">
                Ваше питання
              </label>
              <textarea
                id="assistant-input"
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send(draft)
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder="Напишіть питання…"
                className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-base sm:text-sm dark:border-zinc-700"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                aria-label="Надіслати"
                className="rounded-xl bg-zinc-900 p-3 text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Питання щодо замовлення? Телефонуйте{" "}
              <a href={`tel:${SHOP_PHONE_HREF}`} className="whitespace-nowrap underline">
                {SHOP_PHONE}
              </a>
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A product the assistant suggests, with the quantity it worked out; the buyer can change it and add it. */
function ProductCard({ product, suggested }: { product: Product; suggested: number }) {
  const { cart, addToCart } = useCart()
  const [quantity, setQuantity] = useState(suggested)
  const inCart = cart.some((i) => i.sku === product.sku)
  const inStock = product.stock > 0 && quantity > 0
  const { min, max } = quantityRules(product)
  const byWeight = product.priceUnit === "г"

  return (
    <div className="flex gap-3 rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
      <Link href={`/product/${encodeURIComponent(product.sku)}`} className="shrink-0">
        <ProductImage
          src={product.image}
          alt={product.name}
          width={72}
          height={72}
          sizes="72px"
          className="h-[72px] w-[72px] rounded-lg object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1 space-y-1.5">
        <Link
          href={`/product/${encodeURIComponent(product.sku)}`}
          className="line-clamp-2 text-sm font-medium leading-snug hover:underline"
        >
          {product.name}
        </Link>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {byWeight ? `${formatPrice(product.price * 100)} / 100 г` : formatPrice(product.price)}
          {byWeight && product.length > 0 && ` · ${product.length} м / 100 г`}
          {product.stock > 0 ? ` · є ${formatQuantity(product.stock, product.priceUnit)}` : " · немає в наявності"}
        </p>
        {inStock && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setQuantity(stepQuantity(product, quantity, -1))}
                disabled={quantity <= min}
                aria-label="Зменшити кількість"
                className="p-1.5 disabled:opacity-30"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-14 text-center text-xs font-medium tabular-nums">
                {formatQuantity(quantity, product.priceUnit)}
              </span>
              <button
                type="button"
                onClick={() => setQuantity(stepQuantity(product, quantity, 1))}
                disabled={quantity >= max}
                aria-label="Збільшити кількість"
                className="p-1.5 disabled:opacity-30"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                addToCart(product, quantity, LIST_NAME)
                noteAssistantAdd(product.sku)
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {inCart && <Check className="h-3.5 w-3.5" aria-hidden />}
              {inCart ? "Додати ще" : "У кошик"} · {formatPrice(lineTotal(product, quantity))}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
