"use client"

import { useEffect, useState } from "react"
import { Send, X } from "lucide-react"
import { readStorage, writeStorage } from "@/lib/storage"
import { TELEGRAM_URL } from "@/lib/site"

const KEY = "sinserita:subscribe-card:v1"

/**
 * «Нові кольори — у Telegram» in the catalog, for people who browse without
 * buying. A row among the products, not a pop-up; once someone subscribes or
 * closes it, it doesn't come back.
 */
export function SubscribeCard({ className = "" }: { className?: string }) {
  // Hidden until the browser says it hasn't been dismissed: no flash for those who have.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setShown(readStorage(KEY) === null)
  }, [])
  if (!shown) return null

  const dismiss = (reason: "subscribed" | "closed") => {
    writeStorage(KEY, reason)
    setShown(false)
  }

  return (
    <aside
      aria-label="Підписка на нові кольори"
      className={`relative flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 pr-10 sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Нові кольори — у Telegram</p>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          Кожен колір — одна партія, повторно не привозимо. Нові показуємо в нашому каналі.
        </p>
      </div>
      <a
        href={TELEGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => dismiss("subscribed")}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"
      >
        <Send className="h-4 w-4" aria-hidden />
        Підписатися
      </a>
      <button
        type="button"
        onClick={() => dismiss("closed")}
        aria-label="Закрити"
        className="absolute right-2 top-2 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  )
}
