import Link from "next/link"
import { Check, Clock, CreditCard, RotateCcw, Truck } from "lucide-react"
import { type Product, type ProductPromo, formatPriceShort, promoDeadline } from "./data"
import { OldPrice } from "./promo-price"
import { pluralUk } from "@/lib/utils"

/** Black strip under the header: the promotion in the same words as the ads. */
export function PromoStrip({ promo, category }: { promo: ProductPromo; category: string }) {
  return (
    <div className="flex items-center justify-center gap-2 bg-zinc-900 px-4 py-2 text-center text-xs font-medium text-white sm:text-sm dark:bg-zinc-100 dark:text-zinc-900">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {promo.name} на «{category}» · {promoDeadline(promo)}
      </span>
    </div>
  )
}

/** Marked products (defects, flaws) don't set the «від» price an ad would quote. */
const MARKED = /розрив|брак|дефект|пошкодж/i

/**
 * Header over a category while a promotion covers it: the offer, how many
 * colours are left and the lowest price of 100 g. The products follow at once.
 */
export function PromoCategoryHeader({ category, products }: { category: string; products: Product[] }) {
  const inStock = products.filter((p) => p.stock > 0)
  const promo = inStock.find((p) => p.promo)?.promo
  if (!promo) return null
  const byWeight = inStock.filter((p) => p.priceUnit === "г" && p.oldPrice && !MARKED.test(p.name))
  const cheapest = byWeight.reduce<Product | null>((min, p) => (!min || p.price < min.price ? p : min), null)
  return (
    <section className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 lg:p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {promo.name.replace(/\s*−\d+%$/, "")} · {promoDeadline(promo)}
      </p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-balance lg:text-3xl">
        {category} <span className="whitespace-nowrap">−{promo.percent}%</span>
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        {inStock.length} {pluralUk(inStock.length, ["колір", "кольори", "кольорів"])} в наявності
        {cheapest && cheapest.oldPrice && (
          <>
            {" "}
            · від <span className="font-semibold text-zinc-900 dark:text-zinc-50">{formatPriceShort(cheapest.price * 100)}</span>{" "}
            <OldPrice>{formatPriceShort(cheapest.oldPrice * 100)}</OldPrice> / 100 г
          </>
        )}
      </p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium">
        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        Знижка вже в цінах нижче
      </p>
    </section>
  )
}

const TRUST = [
  { Icon: Truck, title: "Доставка", text: "Нова Пошта та Укрпошта по Україні" },
  { Icon: CreditCard, title: "Оплата", text: "Онлайн або накладеним платежем" },
  { Icon: RotateCcw, title: "Повернення", text: "14 днів, якщо не підійшов колір*" },
]

function ReturnsNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-zinc-500 dark:text-zinc-400 ${className}`}>
      * Якщо пряжа нерозмотана, у первісному вигляді.{" "}
      <Link href="/returns" className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
        Правила повернення
      </Link>
    </p>
  )
}

/** Delivery · payment · returns: one line over the products, a block on the product page. */
export function TrustStrip({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="mb-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {TRUST.map(({ Icon, text }) => (
            <li key={text} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <ReturnsNote className="mt-1" />
      </div>
    )
  }
  return (
    <div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TRUST.map(({ Icon, title, text }) => (
          <li
            key={title}
            className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            <span className="min-w-0 text-sm">
              <span className="block font-semibold">{title}</span>
              <span className="block text-zinc-600 dark:text-zinc-400">{text}</span>
            </span>
          </li>
        ))}
      </ul>
      <ReturnsNote className="mt-2" />
    </div>
  )
}
