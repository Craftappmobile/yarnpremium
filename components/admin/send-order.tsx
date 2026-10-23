"use client"

import { useState } from "react"

/**
 * The order's text and the buyer's messengers: WhatsApp and Viber open the
 * chat with the text in it (Viber on a phone; its desktop app may want it
 * pasted), Telegram opens the chat only, so the text is copied first.
 */
export function SendOrder({ text, phone }: { text: string; phone: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }
  const t = encodeURIComponent(text)
  const button = "flex items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold text-white"
  return (
    <>
      <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 font-sans text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
        {text}
      </pre>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <a className={`${button} bg-[#7360F2]`} href={`viber://chat?number=%2B${phone}&draft=${t}`}>
          Viber
        </a>
        <a className={`${button} bg-[#1A7F4B]`} href={`https://wa.me/${phone}?text=${t}`} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a className={`${button} bg-[#1A78B4]`} href={`https://t.me/+${phone}`} target="_blank" rel="noopener noreferrer" onClick={copy}>
          Telegram (текст скопіюється)
        </a>
        <button type="button" onClick={copy} className={`${button} bg-zinc-900 dark:bg-white dark:text-zinc-900`}>
          {copied ? "Скопійовано ✓" : "Копіювати текст"}
        </button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Viber на комп&apos;ютері може відкрити чат без тексту: тоді натисніть «Копіювати текст» і вставте його.
      </p>
    </>
  )
}
