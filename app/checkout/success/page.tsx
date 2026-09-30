import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2, ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Замовлення прийнято | SINSERITA",
  description: "Дякуємо за замовлення",
}

export default function CheckoutSuccessPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
        <CheckCircle2 className="h-14 w-14 text-emerald-500" strokeWidth={1.5} />
        <h1 className="mt-6 text-2xl font-semibold text-balance">Дякуємо за замовлення!</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400 text-pretty">
          Ваше замовлення прийнято. Найближчим часом ми звʼяжемося з вами для підтвердження деталей
          доставки та оплати.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-white px-5 py-3 text-sm font-medium text-white dark:text-zinc-900 transition-colors hover:bg-zinc-800 dark:hover:bg-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" /> Продовжити покупки
        </Link>
      </div>
    </main>
  )
}
