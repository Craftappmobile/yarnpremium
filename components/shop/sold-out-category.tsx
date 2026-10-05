"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import type { GroupSummary, PromoSummary } from "./catalog-summary"
import { formatPriceShort } from "./data"
import { OldPrice } from "./promo-price"
import { TelegramButton } from "./telegram-button"
import { categoryPath } from "@/lib/category-url"
import { pluralUk } from "@/lib/utils"

/**
 * The page of a category with nothing left: not an empty list but what
 * happened, where new batches are shown first, and the categories like it
 * that are in stock.
 */
export function SoldOutCategory({ category, similar }: { category: string; similar: (GroupSummary | PromoSummary)[] }) {
  const [channelOpened, setChannelOpened] = useState(false)
  return (
    <>
      <section className="rounded-xl border border-zinc-200 bg-white p-5 lg:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Розпродано</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-balance lg:text-3xl">{category}</h2>
        <p className="mt-2 max-w-prose text-sm text-zinc-600 dark:text-zinc-400">
          Ця партія розпродана. Кожен колір — одна партія, повторно не привозимо. Нові партії першими показуємо в нашому
          Telegram-каналі.
        </p>
        {channelOpened ? (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm font-medium">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            Канал відкрито в Telegram. Натисніть там «Підписатися».
          </p>
        ) : (
          <TelegramButton onClick={() => setChannelOpened(true)} className="mt-4 w-full py-3 sm:w-auto sm:px-6">
            Підписатися на нові партії
          </TelegramButton>
        )}
      </section>

      {similar.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold tracking-tight">Схоже в наявності</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {similar.map((g) => {
              const promo = "promo" in g ? g.promo : undefined
              return (
                <li key={g.category}>
                  <Link
                    href={categoryPath(g.category)}
                    className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                  >
                    {promo && (
                      <span className="mb-1.5 self-start rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white dark:bg-white dark:text-zinc-900">
                        −{promo.percent}%
                      </span>
                    )}
                    <span className="font-semibold leading-snug">{promo?.title ?? g.category}</span>
                    {g.composition && (
                      <span className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                        {g.composition}
                      </span>
                    )}
                    <span className="mt-auto pt-3 text-sm tabular-nums">
                      {g.from && (
                        <>
                          від <strong className="font-semibold">{formatPriceShort(g.from.price)}</strong>
                          {g.from.oldPrice && (
                            <OldPrice className="ml-1 text-xs">{formatPriceShort(g.from.oldPrice)}</OldPrice>
                          )}
                          <span className="text-zinc-500 dark:text-zinc-400"> / {g.from.per}</span>
                          <br />
                        </>
                      )}
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {g.count} {pluralUk(g.count, ["товар", "товари", "товарів"])}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <Link href="/" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4">
        Весь каталог
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </>
  )
}
