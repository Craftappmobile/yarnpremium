import Link from "next/link"
import { ArrowRight, Check, Clock, CreditCard, RotateCcw, Truck } from "lucide-react"
import { type ProductPromo, formatPriceShort, promoDeadline } from "./data"
import type { PromoSummary } from "./catalog-summary"
import { OldPrice } from "./promo-price"
import { PromoVideo } from "./promo-video"
import { pluralUk } from "@/lib/utils"

/** Black strip under the header: the promotion in the same words as the ads. */
export function PromoStrip({ promo, category }: { promo: ProductPromo; category: string }) {
  return (
    <div className="flex items-center justify-center gap-2 bg-zinc-900 px-4 py-2 text-center text-xs font-medium text-white sm:text-sm dark:bg-zinc-100 dark:text-zinc-900">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {promo.name}
        <span className="hidden sm:inline"> на «{promo.title ?? category}»</span> · {promoDeadline(promo)}
      </span>
    </div>
  )
}

/**
 * Header of a promotion: the offer, how many colours are left and the lowest
 * price of 100 g. Over its category the products follow at once; on the home
 * page `onShow` adds the button that opens the category.
 */
export function PromoCategoryHeader({ summary, onShow }: { summary: PromoSummary; onShow?: () => void }) {
  const { promo, category, count, from, video } = summary
  return (
    <section className="mb-3 flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 lg:mb-5 lg:gap-6 lg:p-6 dark:border-zinc-800 dark:bg-zinc-900">
      {video && <PromoVideo src={video.src} poster={video.poster} label={`Відео: ${promo.title ?? category}`} />}
      <div className="min-w-0 flex-1">
        {/* Phones skip it: the first row of yarn has to fit on the first screen. */}
        <p className="hidden text-xs font-medium uppercase tracking-wide text-zinc-500 sm:block dark:text-zinc-400">
          {promo.tagline ?? `${promo.name.replace(/\s*−\d+%$/, "")} · ${promoDeadline(promo)}`}
        </p>
        {/* The discount is the one accent: black like the shop's buttons, not a sale red that would fight the yarn. */}
        <div className="flex flex-wrap items-center gap-2 sm:mt-2">
          <span className="rounded-md bg-zinc-900 px-2.5 py-1 text-lg font-bold tabular-nums text-white dark:bg-white dark:text-zinc-900">
            −{promo.percent}%
          </span>
          <h2 className="text-2xl font-semibold tracking-tight text-balance lg:text-3xl">{promo.title ?? category}</h2>
        </div>
        {from && (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 tabular-nums">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">від</span>
            <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{formatPriceShort(from.price)}</span>
            <OldPrice className="text-base">{formatPriceShort(from.oldPrice)}</OldPrice>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">/ 100 г</span>
          </p>
        )}
        {onShow ? (
          // Over the whole catalog the button says how many are on sale; the list below is everything.
          <button
            type="button"
            onClick={onShow}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"
          >
            Дивитись {count} {pluralUk(count, ["товар", "товари", "товарів"])} зі знижкою
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
            Знижка вже в цінах · {count} {pluralUk(count, ["товар", "товари", "товарів"])} в наявності
          </p>
        )}
      </div>
    </section>
  )
}

const TRUST = [
  { Icon: Truck, title: "Доставка", text: "Нова Пошта та Укрпошта по Україні", short: "Доставка по Україні" },
  { Icon: CreditCard, title: "Оплата", text: "Онлайн або накладеним платежем", short: "Накладений платіж" },
  { Icon: RotateCcw, title: "Повернення", text: "14 днів, якщо не підійшов колір", short: "Повернення 14 днів" },
]

const returnsLink = "underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"

/**
 * Delivery · payment · returns. Over the products: one line, so the yarn
 * stays on the first screen; the conditions of a return are on its page.
 * On the product page: a block.
 */
export function TrustStrip({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="mb-3 whitespace-nowrap text-[11px] font-medium text-zinc-600 sm:text-xs dark:text-zinc-300">
        {TRUST[0].short} · {TRUST[1].short} ·{" "}
        <Link href="/returns" className={returnsLink}>
          {TRUST[2].short}
        </Link>
      </p>
    )
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {TRUST.map(({ Icon, title, text }) => (
        <li
          key={title}
          className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          <span className="min-w-0 text-sm">
            <span className="block font-semibold">{title}</span>
            <span className="block text-zinc-600 dark:text-zinc-400">
              {title === "Повернення" ? (
                <Link href="/returns" className={returnsLink}>
                  {text}
                </Link>
              ) : (
                text
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
