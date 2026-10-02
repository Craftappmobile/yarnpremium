"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ArrowLeft, CreditCard } from "lucide-react"
import { formatPrice, formatQuantity } from "./data"
import { type LastOrder, loadLastOrder, saveLastOrder } from "./last-order"
import { payOrder } from "./pay"
import { PAYMENT_LABELS, describeDelivery } from "@/lib/order"

/** What WayForPay reported when the buyer came back (?payment=ok|pending|fail), or nothing. */
type Outcome = "ok" | "pending" | "fail" | null

export function OrderConfirmation() {
  const [last, setLast] = useState<LastOrder | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState("")
  const order = last?.order ?? null

  useEffect(() => {
    const saved = loadLastOrder()
    const status = new URLSearchParams(window.location.search).get("payment")
    const result: Outcome = status === "ok" || status === "pending" || status === "fail" ? status : null
    // Remember a successful payment, so a reload still shows it as paid.
    if (saved && result === "ok" && !saved.order.payment.paid) {
      saved.order.payment.paid = true
      saveLastOrder(saved)
    }
    setLast(saved)
    setOutcome(result)
  }, [])

  const pay = async () => {
    if (!last) return
    setPaying(true)
    setPayError("")
    try {
      if ((await payOrder(last.id)) === "paid") setOutcome("ok")
      else return // On the way to the payment page.
    } catch (e) {
      setPayError((e as Error).message)
    }
    setPaying(false)
  }
  const paid = outcome === "ok" || !!order?.payment.paid

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
                  {i.name} <span className="whitespace-nowrap text-zinc-500">× {formatQuantity(i.quantity, i.unit ?? "шт")}</span>
                </span>
                <span className="whitespace-nowrap tabular-nums">{formatPrice(i.total ?? i.price * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 font-semibold">
            <span>Разом</span>
            <span className="tabular-nums">{formatPrice(order.total)}</span>
          </div>
          <p className="text-zinc-600 dark:text-zinc-300">
            <span className="text-zinc-500">Доставка:</span> {describeDelivery(order.delivery)}
          </p>
          <p className="text-zinc-600 dark:text-zinc-300">
            <span className="text-zinc-500">Оплата:</span> {PAYMENT_LABELS[order.payment.method]}
          </p>

          {order.payment.now > 0 && paid && (
            <div role="status" className="flex gap-3 rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-3 py-3 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Оплату <strong>{formatPrice(order.payment.now)}</strong> отримано.
                {order.payment.onReceipt > 0 && <> Решту ({formatPrice(order.payment.onReceipt)}) ви сплатите при отриманні.</>}
              </p>
            </div>
          )}
          {order.payment.now > 0 && !paid && outcome === "pending" && (
            <div role="status" className="flex gap-3 rounded-md bg-zinc-100 dark:bg-zinc-800 px-3 py-3 text-zinc-700 dark:text-zinc-300">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>Оплата обробляється. Щойно вона надійде, менеджер побачить її в замовленні — нічого робити не потрібно.</p>
            </div>
          )}
          {order.payment.now > 0 && !paid && outcome !== "pending" && (
            <div className="space-y-3 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-3 text-amber-900 dark:text-amber-200">
              <p className="flex gap-3">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {outcome === "fail" ? "Оплата не пройшла. " : "Замовлення ще не оплачене. "}
                  До сплати онлайн: <strong>{formatPrice(order.payment.now)}</strong>.
                  {order.payment.onReceipt > 0 && <> Решту ({formatPrice(order.payment.onReceipt)}) ви сплатите при отриманні.</>}
                </span>
              </p>
              <button
                type="button"
                onClick={pay}
                disabled={paying}
                className="w-full rounded-md bg-zinc-900 dark:bg-white py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-60 disabled:cursor-wait"
              >
                {paying ? "Відкриваємо сторінку оплати…" : `Оплатити ${formatPrice(order.payment.now)}`}
              </button>
              {payError && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {payError}
                </p>
              )}
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
