"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ArrowLeft, CreditCard } from "lucide-react"
import { formatPrice, formatQuantity } from "./data"
import { loadLastOrder } from "./last-order"
import { PAYMENT_LABELS, describeDelivery, type Order } from "@/lib/order"

export function OrderConfirmation() {
  const [order, setOrder] = useState<Order | null>(null)

  useEffect(() => {
    setOrder(loadLastOrder())
  }, [])

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <CheckCircle2 className="h-14 w-14 text-emerald-500" strokeWidth={1.5} />
      <h1 className="mt-6 text-2xl font-semibold text-balance">Дякуємо за замовлення!</h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400 text-pretty">
        Ваше замовлення прийнято. Найближчим часом ми звʼяжемося з вами для підтвердження деталей доставки та оплати.
      </p>

      {order?.number && (
        <p className="mt-4 text-sm">
          Номер замовлення: <strong className="tabular-nums">№{order.number}</strong>
        </p>
      )}

      {order && (
        <div className="mt-8 w-full space-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 text-left text-sm">
          <ul className="space-y-1">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span className="text-zinc-600 dark:text-zinc-300">
                  {i.name} <span className="text-zinc-500">× {formatQuantity(i.quantity, i.unit ?? "шт")}</span>
                </span>
                <span className="whitespace-nowrap tabular-nums">{formatPrice(i.price * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 font-semibold">
            <span>Загалом</span>
            <span className="tabular-nums">{formatPrice(order.total)}</span>
          </div>
          <p className="text-zinc-600 dark:text-zinc-300">
            <span className="text-zinc-500">Доставка:</span> {describeDelivery(order.delivery)}
          </p>
          <p className="text-zinc-600 dark:text-zinc-300">
            <span className="text-zinc-500">Оплата:</span> {PAYMENT_LABELS[order.payment.method]}
          </p>

          {/* Online payment is not connected yet — placeholder until the payment provider is integrated. */}
          {order.payment.now > 0 && (
            <div className="flex gap-3 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-amber-800 dark:text-amber-300">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                До сплати онлайн: <strong>{formatPrice(order.payment.now)}</strong>. Онлайн-оплата на сайті незабаром
                запрацює — поки що менеджер надішле вам посилання для оплати.
                {order.payment.onReceipt > 0 && <> Решту ({formatPrice(order.payment.onReceipt)}) ви сплатите при отриманні.</>}
              </p>
            </div>
          )}
        </div>
      )}

      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-white px-5 py-3 text-sm font-medium text-white dark:text-zinc-900 transition-colors hover:bg-zinc-800 dark:hover:bg-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" /> Продовжити покупки
      </Link>
    </div>
  )
}
