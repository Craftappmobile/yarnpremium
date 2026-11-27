"use client"

import Link from "next/link"
import type { MouseEvent } from "react"
import { useTimeLeft } from "./campaign-blocks"
import { trackTelegramLead } from "./analytics"
import { pluralUk } from "@/lib/utils"

/** The Black Friday channel the ads lead to. */
export const TELEGRAM_CHANNEL = "sincerita_blackfriday"
const CHANNEL_URL = `https://t.me/${TELEGRAM_CHANNEL}`

const pad = (n: number) => String(n).padStart(2, "0")

function Countdown({ endsAt }: { endsAt?: string }) {
  const t = useTimeLeft(endsAt)
  // Before the page is in the browser, and once the sale is over: no clock.
  if (!t || t.d + t.h + t.m === 0) return null
  const parts = [`${t.d} ${pluralUk(t.d, ["день", "дні", "днів"])}`, `${pad(t.h)} год`, `${pad(t.m)} хв`]
  return (
    <p className="flex items-center gap-1.5 text-[13px] tabular-nums text-zinc-700">
      До кінця:
      {parts.map((p) => (
        <span key={p} className="rounded-lg bg-white px-2.5 py-1.5 text-[15px] font-bold text-zinc-950">
          {p}
        </span>
      ))}
    </p>
  )
}

/**
 * The ad landing page (app/tg): Facebook and Instagram ads lead here, and its
 * one job is the tap on «Відкрити канал у Telegram». Light, as the approved
 * mock-up, in the shop's own words, with the countdown; no photos, and the
 * sale's terms are left to the channel.
 */
export function TelegramLanding({ endsAt, subscribers }: { endsAt?: string; subscribers: string }) {
  const onOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    trackTelegramLead(TELEGRAM_CHANNEL)
    // A moment for the pixel to send the Lead before the page gives way to Telegram.
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      setTimeout(() => window.location.assign(CHANNEL_URL), 250)
    }
  }
  return (
    <main
      id="content"
      className="mx-auto flex min-h-dvh max-w-md flex-col bg-[#eeeeee] px-[22px] pb-6 pt-[26px] text-zinc-950 sm:max-w-none"
    >
      <p className="text-center text-[15px] font-extrabold tracking-[0.16em]">SINCERITA</p>

      <div className="mx-auto my-auto flex w-full max-w-md flex-col items-center gap-5 py-8 text-center">
        <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-tight text-balance">
          <span aria-hidden>🖤 </span>Чорна п&apos;ятниця Sincerita — тільки для своїх.
        </h1>
        <span className="rounded-xl bg-zinc-950 px-4 py-1.5 text-[26px] font-extrabold leading-tight tracking-tight text-white">
          Вже стартувала!
        </span>
        <p className="text-[20px] font-semibold leading-snug text-balance">Лише 3 дні, і все — в&nbsp;закритому Telegram.</p>
        <Countdown endsAt={endsAt} />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-2">
        <p className="text-center text-[17px] font-bold">Встигніть зайти 👉</p>
        <a
          href={CHANNEL_URL}
          onClick={onOpen}
          className="flex min-h-[58px] items-center justify-center gap-2.5 rounded-full bg-[#229ed9] text-[17px] font-bold text-white hover:bg-[#1c8fc5]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M21.9 4.3 18.6 19.8c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.9 13.3 1 11.8c-1.1-.3-1.1-1.1.2-1.6L20.5 2.8c.9-.3 1.7.2 1.4 1.5z" />
          </svg>
          Відкрити канал у Telegram
        </a>
        <p className="text-center text-[13px] text-zinc-600">Вже {subscribers} підписниць · безкоштовно, без спаму</p>
        <Link href="/chorna-pyatnytsia" className="self-center py-1 text-[13px] text-zinc-700 underline underline-offset-[3px] hover:text-zinc-950">
          Або одразу на сайт →
        </Link>
      </div>
    </main>
  )
}
