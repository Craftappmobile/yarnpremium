"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { MessageCircle } from "lucide-react"
import { trackAssistant } from "./analytics"
import type { AssistantProduct } from "./assistant-panel"

// Launcher of the shopping assistant, on every page but checkout. The chat
// itself loads only when opened. Shown only while NEXT_PUBLIC_ASSISTANT_ENABLED
// is "1", so it can be switched on once ANTHROPIC_API_KEY is set in Vercel.

const AssistantPanel = dynamic(() => import("./assistant-panel").then((m) => m.AssistantPanel), { ssr: false })

export const ASSISTANT_ENABLED = process.env.NEXT_PUBLIC_ASSISTANT_ENABLED === "1"

const OPEN_EVENT = "sinserita:assistant-open"

/**
 * Opens the chat from anywhere on the page. With a product, the chat is about
 * it: its own ready questions, and the assistant is told which product it is.
 */
export function openAssistant(product?: AssistantProduct, source = "product_page") {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: product ?? null }))
  trackAssistant("assistant_open", { source })
}

export function Assistant() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [product, setProduct] = useState<AssistantProduct | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      setProduct((e as CustomEvent<AssistantProduct | null>).detail)
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  if (!ASSISTANT_ENABLED || pathname.startsWith("/checkout") || pathname.startsWith("/admin")) return null
  // Product pages have the consultant in the card and in the buy bar on phones.
  const onProduct = pathname.startsWith("/product/")

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setProduct(null)
          setOpen(true)
          trackAssistant("assistant_open", { source: "launcher" })
        }}
        aria-haspopup="dialog"
        className={`fixed bottom-5 right-4 z-30 items-center gap-2 rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${
          onProduct ? "hidden md:inline-flex" : "inline-flex"
        }`}
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
        <span>Консультант</span>
      </button>
      {open && <AssistantPanel product={product} onClose={() => setOpen(false)} />}
    </>
  )
}
