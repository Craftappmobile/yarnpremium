"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Camera, Check, CreditCard, Mail, MapPin, Package, Send, Truck, Wallet } from "lucide-react"
import { formatPrice, formatQuantity } from "./data"
import { type LastOrder, loadLastOrder, saveLastOrder } from "./last-order"
import { payOrder } from "./pay"
import { ProductImage } from "./product-image"
import { PICKUP_POINT, describeDelivery } from "@/lib/order"
import { INSTAGRAM_HANDLE, INSTAGRAM_URL, TELEGRAM_URL } from "@/lib/site"

/** What WayForPay reported when the buyer came back (?payment=ok|pending|fail), or nothing. */
type Outcome = "ok" | "pending" | "fail" | null

// Texts follow the «Доставка, повернення та оплата» page (components/shop/site-content.ts):
// a promise made here that the shop doesn't keep hurts most right after a purchase.
export function OrderConfirmation() {
  const [last, setLast] = useState<LastOrder | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState("")
  const [channelOpened, setChannelOpened] = useState(false)
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
  // Something is still to be paid online: that comes first, nothing else competes with it.
  const owes = !!order && order.payment.now > 0 && !paid
  const pickup = order?.delivery.method === "pickup"
  const ukrposhta = order?.delivery.method === "ukrposhta"

  return (
    <div className="mx-auto max-w-[560px] px-4 pb-16 pt-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
        <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden />
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-balance">Дякуємо, замовлення прийняте</h1>
      {order ? (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {order.number ? <>Замовлення №{order.number} · </> : null}
          {formatPrice(order.total)}
        </p>
      ) : (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Менеджер звʼяжеться з вами, щоб підтвердити деталі доставки та оплати.
        </p>
      )}

      {order && owes && (
        <div className="mt-5 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {outcome === "pending" ? (
            <p className="flex gap-3">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Оплата обробляється. Щойно вона надійде, менеджер побачить її в замовленні — нічого робити не потрібно.</span>
            </p>
          ) : (
            <>
              <p className="flex gap-3">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {outcome === "fail" ? "Оплата не пройшла. " : "Замовлення ще не оплачене. "}
                  {order.payment.onReceipt > 0 ? "Передоплата" : "До сплати онлайн"}:{" "}
                  <strong>{formatPrice(order.payment.now)}</strong>.
                  {order.payment.onReceipt > 0 && <> Решту ({formatPrice(order.payment.onReceipt)}) ви сплатите при отриманні.</>}
                </span>
              </p>
              <button
                type="button"
                onClick={pay}
                disabled={paying}
                className="w-full rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-zinc-900"
              >
                {paying ? "Відкриваємо сторінку оплати…" : `Оплатити ${formatPrice(order.payment.now)}`}
              </button>
              {payError && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {payError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {order && (
        <section className="mt-5 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <ul>
            {order.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 border-b border-zinc-200 p-3 dark:border-zinc-800">
                {i.image ? (
                  <ProductImage src={i.image} alt="" width={48} height={56} sizes="48px" className="h-14 w-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <span aria-hidden className="h-14 w-12 shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{i.name}</p>
                  <p className="text-xs text-zinc-500">{formatQuantity(i.quantity, i.unit ?? "шт")}</p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatPrice(i.total ?? i.price * i.quantity)}</p>
              </li>
            ))}
          </ul>

          {/* What happens next. */}
          <ol className="space-y-3 p-4 text-sm">
            <Step Icon={Wallet} title={paymentTitle(order, paid)}>
              {paymentText(order, paid)}
            </Step>
            {pickup ? (
              <Step Icon={MapPin} title="Самовивіз">
                {PICKUP_POINT.address} ({PICKUP_POINT.hours})
              </Step>
            ) : (
              <>
                <Step Icon={Package} title="Відправимо протягом 1–4 робочих днів">
                  після підтвердження замовлення
                </Step>
                <Step Icon={Truck} title={ukrposhta ? "Трек-номер надішлемо в SMS" : "Номер ТТН надішлемо в SMS"}>
                  {describeDelivery(order.delivery)}
                </Step>
              </>
            )}
            {order.newsletter && order.customer.email && (
              <Step Icon={Mail} title="Ви підписані на нові кольори">
                Листи прийдуть на {order.customer.email}. Відписатися можна в кожному листі.
              </Step>
            )}
          </ol>
        </section>
      )}

      {/* One offer, once nothing is left to pay. */}
      {!owes && (
        <section className="mt-6 rounded-lg bg-zinc-900 p-5 text-white dark:bg-zinc-100 dark:text-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-white/60 dark:text-zinc-500">Нові кольори</p>
          <p className="mt-2 text-xl font-semibold tracking-tight">Не пропустіть нові кольори — у Telegram</p>
          <p className="mt-1.5 text-sm text-white/80 dark:text-zinc-600">
            Кожен колір — одна партія, повторно не привозимо. Нові кольори показуємо в нашому каналі.
          </p>
          {channelOpened ? (
            <p role="status" className="mt-4 flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              Канал відкрито в Telegram. Натисніть там «Підписатися».
            </p>
          ) : (
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setChannelOpened(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-semibold text-zinc-900 dark:bg-zinc-900 dark:text-white"
            >
              <Send className="h-4 w-4" aria-hidden />
              Підписатися на канал
            </a>
          )}
        </section>
      )}

      <section className="mt-4 flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <Camera className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Звʼязали з нашої пряжі? Позначте{" "}
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50">
            @{INSTAGRAM_HANDLE}
          </a>{" "}
          в Instagram — нам дуже приємно бачити ваші роботи.
        </p>
      </section>

      <Link href="/" className="mt-6 block text-center text-sm font-medium underline underline-offset-4">
        Повернутися до каталогу
      </Link>
    </div>
  )
}

type Order = NonNullable<LastOrder["order"]>

function paymentTitle(order: Order, paid: boolean): string {
  const { method, now } = order.payment
  if (method === "on_pickup") return "Оплата при отриманні в магазині"
  if (method === "cod") return paid ? `Передоплату ${formatPrice(now)} отримано` : "Накладений платіж"
  return paid ? "Оплачено онлайн" : "Оплата карткою онлайн"
}

function paymentText(order: Order, paid: boolean): string {
  const { method, onReceipt } = order.payment
  if (method === "on_pickup") return "Оплатите, коли заберете замовлення."
  if (method === "cod") {
    return `Решту ${formatPrice(onReceipt)} сплатите у відділенні перевізника при отриманні; перевізник бере власну комісію за переказ коштів.`
  }
  return paid ? `Оплату ${formatPrice(order.total)} отримано.` : "Оплатіть замовлення, щоб ми його відправили."
}

function Step({ Icon, title, children }: { Icon: typeof Check; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-zinc-500 dark:text-zinc-400">{children}</p>
      </div>
    </li>
  )
}
