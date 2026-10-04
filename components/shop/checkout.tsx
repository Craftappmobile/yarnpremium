"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, MapPin, Clock } from "lucide-react"
import { useCart } from "./cart-context"
import { SECOND_ITEM, formatPrice, formatQuantity, TAIL_DISCOUNT, lineTotal, tailGrams } from "./data"
import { OldPrice } from "./promo-price"
import { NovaPoshtaFields } from "./nova-poshta-fields"
import { UkrposhtaFields } from "./ukrposhta-fields"
import {
  COD_PREPAYMENT,
  DELIVERY_METHODS,
  PAYMENT_LABELS,
  PICKUP_POINT,
  paymentMethodsFor,
  paymentSplit,
  validateOrderFields,
  type DeliveryMethod,
  type Order,
  type OrderDelivery,
  type OrderRequest,
  type PaymentMethod,
  type StockChange,
} from "@/lib/order"
import { type LastOrder, loadLastOrder, saveLastOrder } from "./last-order"
import { submitPaymentForm } from "./pay"
import { trackBeginCheckout, trackPurchase } from "./analytics"
import { readUtm } from "./utm-capture"
import { clearAssistantAttribution, readAssistantAttribution } from "./assistant-attribution"
import { clearVideoAttribution, readVideoAttribution } from "./video-attribution"

const CARRIER_LOGOS: Partial<Record<DeliveryMethod, string>> = {
  np_warehouse: "/carriers/nova-poshta.png",
  np_postomat: "/carriers/nova-poshta.png",
  np_courier: "/carriers/nova-poshta.png",
  ukrposhta: "/carriers/ukrposhta.png",
}

export function Checkout() {
  const router = useRouter()
  const { cart, priced, total, saved, clearCart, hydrated, refresh } = useCart()

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [notes, setNotes] = useState("")
  const [delivery, setDelivery] = useState<OrderDelivery>({ method: "np_warehouse" })
  const [payment, setPayment] = useState<PaymentMethod>("card")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [website, setWebsite] = useState("")
  // One id per checkout: a repeated submit can't create a second order.
  const [orderId] = useState(() => crypto.randomUUID())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [stockChanges, setStockChanges] = useState<StockChange[]>([])

  // Back from the payment page without paying: the cart is already empty, so point to the order.
  const [unpaid, setUnpaid] = useState<LastOrder | null>(null)
  useEffect(() => {
    const last = loadLastOrder()
    if (last && last.order.payment.now > 0 && !last.order.payment.paid) setUnpaid(last)
  }, [])

  // Reported once, when the restored cart is first seen on this page.
  const checkoutTracked = useRef(false)
  useEffect(() => {
    if (!hydrated || checkoutTracked.current || cart.length === 0) return
    checkoutTracked.current = true
    trackBeginCheckout(cart)
  }, [hydrated, cart])

  const grandTotal = total
  const payments = paymentMethodsFor(delivery.method)
  // Cash on delivery only makes sense when something is left to pay after the prepayment.
  const codAvailable = grandTotal > COD_PREPAYMENT
  const effectivePayment: PaymentMethod = payment === "cod" && !codAvailable ? "card" : payment
  const split = paymentSplit(effectivePayment, grandTotal)
  const deliveryHint = DELIVERY_METHODS.find((m) => m.value === delivery.method)?.hint

  const selectDelivery = (method: DeliveryMethod) => {
    // Keep the chosen city when switching between Nova Poshta options; drop
    // anything that doesn't carry over (a branch is not a postomat).
    setDelivery((prev) => {
      const sameCarrier = prev.method.startsWith("np_") && method.startsWith("np_")
      return { method, city: sameCarrier ? prev.city : undefined }
    })
    if (!paymentMethodsFor(method).includes(payment)) setPayment(paymentMethodsFor(method)[0])
    setErrors({})
  }

  const patchDelivery = (patch: Partial<OrderDelivery>) => setDelivery((prev) => ({ ...prev, ...patch }))

  // Wait for the saved cart so a returning shopper doesn't see "empty" flash by.
  if (!hydrated) return <div className="min-h-[60vh]" aria-busy="true" />

  // Empty cart guard
  if (cart.length === 0) {
    if (unpaid) {
      return (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-xl font-medium text-balance">Замовлення №{unpaid.order.number} чекає на оплату</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Замовлення вже прийнято. Оплатити {formatPrice(unpaid.order.payment.now)} можна будь-коли зі сторінки замовлення.
          </p>
          <Link
            href="/checkout/success"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-white px-5 py-3 text-sm font-medium text-white dark:text-zinc-900"
          >
            До замовлення та оплати
          </Link>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-medium">Ваш кошик порожній</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Додайте товари, щоб оформити замовлення.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4" /> До магазину
        </Link>
      </div>
    )
  }

  const customer = { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), email: email.trim() }

  // Takes the customer to the first field that needs fixing.
  const focusFirstError = () =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]')
      el?.focus()
      el?.scrollIntoView({ block: "center", behavior: "smooth" })
    })

  const validate = () => {
    const e = validateOrderFields(customer, delivery)
    setErrors(e)
    if (Object.keys(e).length > 0) focusFirstError()
    return Object.keys(e).length === 0
  }

  const fieldA11y = (key: string) => ({
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
  })

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (submitting || !validate()) return
    setSubmitting(true)
    setSubmitError("")
    setStockChanges([])

    const assistant = readAssistantAttribution()
    const request: OrderRequest = {
      id: orderId,
      customer,
      items: cart.map((i) => ({ sku: i.sku, quantity: i.quantity })),
      delivery,
      payment: effectivePayment,
      notes: notes.trim(),
      utm: readUtm(),
      assistant,
      video: readVideoAttribution(),
      website,
    }
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        // On a bad connection give up and let the customer retry; the same
        // checkout id makes the retry safe (no duplicate order).
        signal: AbortSignal.timeout(45_000),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.order) {
        saveLastOrder({ id: orderId, order: data.order as Order })
        trackPurchase(data.order as Order, orderId, Boolean(assistant))
        clearAssistantAttribution()
        clearVideoAttribution()
        clearCart()
        // Online part: straight to WayForPay; it brings the buyer back to the confirmation page.
        if (data.payment) submitPaymentForm(data.payment)
        else router.push("/checkout/success")
        return
      }
      if (data.changes) {
        // Show what changed and bring the cart in line before the customer tries again.
        setStockChanges(data.changes)
        await refresh()
      }
      if (data.fields) {
        setErrors(data.fields)
        focusFirstError()
      }
      setSubmitError(data.error ?? "Не вдалося оформити замовлення. Спробуйте ще раз.")
    } catch {
      setSubmitError("Немає звʼязку з сервером. Перевірте інтернет і натисніть «Підтвердити» ще раз — повторне натискання не створить друге замовлення.")
    }
    setSubmitting(false)
  }

  const inputBase =
    "w-full rounded-md border bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
  const errCls = (k: string) => (errors[k] ? "border-red-500" : "border-zinc-300 dark:border-zinc-700")

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" /> До магазину
      </Link>

      <form onSubmit={handleSubmit} noValidate className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_420px]">
        {/* Left: contacts + delivery */}
        <div>
          <h1 className="sr-only">Оформлення замовлення</h1>
          <h2 className="text-lg font-semibold uppercase tracking-wide">Контактні дані</h2>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="mb-1.5 block text-sm">
                Імʼя <span className="text-red-600">*</span>
              </label>
              <input id="firstName" name="firstName" maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" {...fieldA11y("firstName")} className={`${inputBase} ${errCls("firstName")}`} />
              <FieldError id="firstName" error={errors.firstName} />
            </div>
            <div>
              <label htmlFor="lastName" className="mb-1.5 block text-sm">
                Прізвище <span className="text-red-600">*</span>
              </label>
              <input id="lastName" name="lastName" maxLength={100} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" {...fieldA11y("lastName")} className={`${inputBase} ${errCls("lastName")}`} />
              <FieldError id="lastName" error={errors.lastName} />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="phone" className="mb-1.5 block text-sm">
              Телефон <span className="text-red-600">*</span>
            </label>
            <input id="phone" name="phone" maxLength={40} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+380 67 123 45 67" {...fieldA11y("phone")} className={`${inputBase} ${errCls("phone")}`} />
            <FieldError id="phone" error={errors.phone} />
          </div>

          <div className="mt-4">
            <label htmlFor="email" className="mb-1.5 block text-sm">
              E-mail адреса <span className="text-red-600">*</span>
            </label>
            <input id="email" name="email" maxLength={200} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" spellCheck={false} placeholder="name@example.com" {...fieldA11y("email")} className={`${inputBase} ${errCls("email")}`} />
            <FieldError id="email" error={errors.email} />
          </div>

          <h2 className="mt-10 text-lg font-semibold uppercase tracking-wide">Доставка</h2>

          <div className="mt-5 space-y-2" role="radiogroup" aria-label="Спосіб доставки">
            {DELIVERY_METHODS.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer flex-col items-start gap-0.5 rounded-md border px-4 py-3 text-sm transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                  delivery.method === m.value
                    ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-900"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="delivery"
                    checked={delivery.method === m.value}
                    onChange={() => selectDelivery(m.value)}
                    className="accent-zinc-900 dark:accent-white"
                  />
                  {/* The carrier's mark finds the familiar option faster than reading; pickup keeps the space. */}
                  {CARRIER_LOGOS[m.value] ? (
                    <img src={CARRIER_LOGOS[m.value]} alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-sm" />
                  ) : (
                    <span aria-hidden className="h-5 w-5 shrink-0" />
                  )}
                  {m.label}
                </span>
                <span className="pl-[57px] text-xs text-zinc-500 sm:pl-0 sm:text-right">{m.hint}</span>
              </label>
            ))}
          </div>

          <div className="mt-6 space-y-4">
            {delivery.method.startsWith("np_") && (
              <NovaPoshtaFields
                // Remount per method so each option starts with a clean point/street search.
                key={delivery.method}
                mode={delivery.method as "np_warehouse" | "np_postomat" | "np_courier"}
                delivery={delivery}
                onChange={patchDelivery}
                errors={errors}
                inputClass={inputBase}
              />
            )}

            {delivery.method === "ukrposhta" && (
              <UkrposhtaFields delivery={delivery} onChange={patchDelivery} errors={errors} inputClass={inputBase} />
            )}

            {delivery.method === "pickup" && (
              <div className="space-y-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                  {PICKUP_POINT.address}
                </p>
                <p className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                  {PICKUP_POINT.hours}
                </p>
                <p className="text-xs text-zinc-500">Ми зателефонуємо, коли замовлення буде готове до видачі.</p>
              </div>
            )}
          </div>

          <div className="mt-6">
            <label htmlFor="notes" className="mb-1.5 block text-sm">Коментар до замовлення (необовʼязково)</label>
            <textarea
              id="notes"
              name="notes"
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Наприклад: зателефонуйте перед відправкою…"
              className={`${inputBase} border-zinc-300 dark:border-zinc-700 resize-none`}
            />
          </div>
        </div>

        {/* Right: order summary + payment */}
        <div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <h2 className="text-lg font-semibold uppercase tracking-wide text-center">Ваше замовлення</h2>

            <div className="mt-5 flex justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <span>Товар</span>
              <span>Сума</span>
            </div>

            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {cart.map((item, index) => {
                const line = priced[index]
                return (
                <li key={item.id} className="flex justify-between gap-3 py-3 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {item.name} <span className="whitespace-nowrap text-zinc-500">× {formatQuantity(item.quantity, item.priceUnit)}</span>
                    {line?.second ? (
                      <span className="block text-xs text-emerald-700">{SECOND_ITEM.name}</span>
                    ) : (
                      item.promo && <span className="block text-xs text-emerald-700">{item.promo.name}</span>
                    )}
                    {!line?.second && tailGrams(item, item.quantity) > 0 && (
                      <span className="block text-xs text-emerald-700">
                        З них {formatQuantity(tailGrams(item, item.quantity), item.priceUnit)} — залишок бобіни зі знижкою {TAIL_DISCOUNT * 100}%
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    {formatPrice(line?.total ?? lineTotal(item, item.quantity))}
                    {line && line.saved > 0 ? (
                      <OldPrice className="block text-xs">{formatPrice(line.total + line.saved)}</OldPrice>
                    ) : null}
                  </span>
                </li>
                )
              })}
            </ul>

            <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 py-3 text-sm font-medium">
              <span>Товари</span>
              <span className="tabular-nums">{formatPrice(total)}</span>
            </div>

            {saved > 0 && (
              <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 py-3 text-sm text-emerald-700 dark:text-emerald-500">
                <span>Економія</span>
                <span className="tabular-nums">{formatPrice(saved)}</span>
              </div>
            )}

            <div className="flex justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 py-3 text-sm">
              <span className="font-medium">Доставка</span>
              <span className="text-right text-zinc-500">{deliveryHint}</span>
            </div>

            <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 text-base font-semibold">
              <span>Разом</span>
              <span className="tabular-nums">{formatPrice(grandTotal)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide">Оплата</p>
            <div className="space-y-3" role="radiogroup" aria-label="Спосіб оплати">
              {payments.map((method) => {
                const disabled = method === "cod" && !codAvailable
                return (
                  <label
                    key={method}
                    className={`flex items-start gap-2 text-sm font-medium ${disabled ? "cursor-not-allowed text-zinc-500" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      checked={effectivePayment === method}
                      disabled={disabled}
                      onChange={() => setPayment(method)}
                      className="mt-0.5 accent-zinc-900 dark:accent-white"
                    />
                    <span>
                      {PAYMENT_LABELS[method]}
                      {disabled && (
                        <span className="block text-xs font-normal">
                          Доступний для замовлень понад {formatPrice(COD_PREPAYMENT)}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>

            <div className="mt-3 space-y-1 rounded-md bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
              {effectivePayment === "card" && (
                <p>Після підтвердження відкриється захищена сторінка оплати WayForPay: картка, Apple Pay або Google Pay.</p>
              )}
              {effectivePayment === "cod" && (
                <p>
                  Передоплату ви сплатите одразу на захищеній сторінці WayForPay, решту — при отриманні у відділенні (плюс
                  комісія перевізника за накладений платіж).
                </p>
              )}
              {effectivePayment === "on_pickup" && <p>Оплата готівкою або карткою в магазині під час отримання.</p>}
              {split.now > 0 && (
                <p className="flex justify-between font-medium text-zinc-800 dark:text-zinc-200">
                  <span>До сплати онлайн</span>
                  <span className="tabular-nums">{formatPrice(split.now)}</span>
                </p>
              )}
              {split.onReceipt > 0 && (
                <p className="flex justify-between font-medium text-zinc-800 dark:text-zinc-200">
                  <span>При отриманні</span>
                  <span className="tabular-nums">{formatPrice(split.onReceipt)}</span>
                </p>
              )}
            </div>

            <p className="mt-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Ваші персональні дані використовуються для обробки замовлення та описані в{" "}
              <Link href="/privacy" className="underline underline-offset-2">
                політиці конфіденційності
              </Link>
              .
            </p>

            {stockChanges.length > 0 && (
              <div className="mt-4 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <p className="font-medium">Поки ви оформлювали, змінилася наявність. Кошик оновлено:</p>
                <ul className="mt-1 list-disc pl-4">
                  {stockChanges.map((c) => (
                    <li key={c.sku}>
                      {c.name} — {c.available > 0 ? `лишилося ${formatQuantity(c.available, c.unit)}` : "розпродано"}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Перевірте замовлення і підтвердьте ще раз.</p>
              </div>
            )}
            {submitError && stockChanges.length === 0 && (
              <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
                {submitError}
              </p>
            )}

            {/* Honeypot: hidden from people; bots that fill it are rejected. */}
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />

            <button
              type="submit"
              disabled={submitting}
              className="mt-4 w-full rounded-md bg-zinc-900 dark:bg-white py-3 text-sm font-semibold uppercase tracking-wide text-white dark:text-zinc-900 transition-colors hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-60 disabled:cursor-wait"
            >
              {submitting
                ? split.now > 0
                  ? "Переходимо до оплати…"
                  : "Оформлюємо…"
                : split.now > 0
                  ? `Підтвердити й оплатити ${formatPrice(split.now)}`
                  : "Підтвердити замовлення"}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null
  return (
    <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
      {error}
    </p>
  )
}
