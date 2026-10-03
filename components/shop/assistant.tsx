"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { MessageCircle } from "lucide-react"
import { trackAssistant } from "./analytics"

// Launcher of the shopping assistant, on every page but checkout. The chat
// itself loads only when opened. Shown only while NEXT_PUBLIC_ASSISTANT_ENABLED
// is "1", so it can be switched on once ANTHROPIC_API_KEY is set in Vercel.

const AssistantPanel = dynamic(() => import("./assistant-panel").then((m) => m.AssistantPanel), { ssr: false })

const ENABLED = process.env.NEXT_PUBLIC_ASSISTANT_ENABLED === "1"

export function Assistant() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  if (!ENABLED || pathname.startsWith("/checkout") || pathname.startsWith("/admin")) return null
  // Product pages have a buy bar along the bottom on phones: sit above it.
  const lifted = pathname.startsWith("/product/")

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          trackAssistant("assistant_open")
        }}
        aria-haspopup="dialog"
        className={`fixed right-4 z-30 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${
          lifted ? "bottom-24 md:bottom-5" : "bottom-5"
        }`}
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
        <span>Консультант</span>
      </button>
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
    </>
  )
}
