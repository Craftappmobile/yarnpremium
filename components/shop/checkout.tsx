"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, MapPin, Clock } from "lucide-react"
import { useCart } from "./cart-context"
import { formatPrice, applyCoupon, type Coupon } from "./data"
import { NovaPoshtaFields } from "./nova-poshta-fields"
import {
  COD_PREPAYMENT,
  DELIVERY_METHODS,
  PAYMENT_LABELS,
  PICKUP_POINT,
  paymentMethodsFor,
  paymentSplit,
  type DeliveryMethod,
  type Order,
  type OrderDelivery,
  type PaymentMethod,
} from "@/lib/order"
import { saveLastOrder } from "./last-order"

export function Checkout() {
  const router = useRouter()
  const { cart, total, clearCart, hydrated } = useCart()

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [notes, setNotes] = useState("")
  const [delivery, setDelivery] = useState<OrderDelivery>({ method: "np_warehouse" })
  const [payment, setPayment] = useState<PaymentMethod>("card")
  const [showCoupon, setShowCoupon] = useState(false)
  const [coupon, setCoupon] = useState("")
  const [appliedCoupon, setAppliedCoupon] = useState<{ coupon: Coupon; discount: number } | null>(null)
  const [couponError, setCouponError] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Recompute the discount against the live subtotal so it stays valid if the
  // cart changes after a coupon was applied.
  const discount = appliedCoupon ? Math.min(appliedCoupon.discount, total) : 0
  const grandTotal = Math.max(0, total - discount)
  const payments = paymentMethodsFor(delivery.method)
  // Cash on delivery only makes sense when something is left to pay after the prepayment.
  const codAvailable = grandTotal > COD_PREPAYMENT
  const effectivePayment: PaymentMethod = payment === "cod" && !codAvailable ? "card" : payment
  const split = paymentSplit(effectivePayment, grandTotal)
  const deliveryHint = DELIVERY_METHODS.find((m) => m.value === delivery.method)?.hint

  const handleApplyCoupon = () => {
    const result = applyCoupon(coupon, total)
    if (result.ok) {
      setAppliedCoupon({ coupon: result.coupon, discount: result.discount })
      setCouponError("")
    } else {
      setAppliedCoupon(null)
      setCouponError(result.error)
    }
  }

  const removeCoupon = () => {
    setAppliedCoupon(null)
    setCoupon("")
    setCouponError("")
  }

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

  const validate = () => {
    const e: Record<string, string> = {}
    if (!firstName.trim()) e.firstName = "Вкажіть імʼя"
    if (!lastName.trim()) e.lastName = "Вкажіть прізвище"
    const digits = phone.replace(/\D/g, "")
    if (digits.length < 10 || digits.length > 12) e.phone = "Вкажіть коректний телефон"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Вкажіть коректний email"
    if (delivery.method !== "pickup") {
      if (!delivery.city?.name.trim()) e.city = "Оберіть населений пункт"
      if (delivery.method === "np_courier") {
        if (!delivery.address?.street.trim()) e.street = "Вкажіть вулицю"
        if (!delivery.address?.house.trim()) e.house = "Вкажіть номер будинку"
      } else if (!delivery.point?.name.trim()) {
        e.point = delivery.method === "np_postomat" ? "Оберіть поштомат" : "Оберіть відділення"
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return

    const order: Order = {
      customer: { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), email: email.trim() },
      items: cart.map((i) => ({ id: i.id, sku: i.sku, name: i.name, price: i.price, quantity: i.quantity })),
      subtotal: total,
      discount,
      coupon: appliedCoupon?.coupon.code ?? null,
      total: grandTotal,
      delivery,
      payment: { method: effectivePayment, ...split },
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    }

    // No backend yet: keep the order for the confirmation page. Sending it to
    // KeyCRM and taking the online payment are the next steps.
    saveLastOrder(order)
    clearCart()
    router.push("/checkout/success")
  }

  const inputBase =
    "w-full rounded-md border bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-900 dark:focus:border-zinc-100"
  const errCls = (k: string) => (errors[k] ? "border-red-500" : "border-zinc-300 dark:border-zinc-700")

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" /> До магазину
      </Link>

      {/* Coupon */}
      <div className="mt-6 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Маєте купон знижки? </span>
        <button
          type="button"
          onClick={() => setShowCoupon((s) => !s)}
          className="font-medium underline underline-offset-4"
        >
          Натисніть тут, щоб ввести код купону знижки
        </button>
        {showCoupon && (
          <div className="mt-3">
            <div className="flex gap-2">
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    handleApplyCoupon()
                  }
                }}
                placeholder="Код купону"
                className={`${inputBase} border-zinc-300 dark:border-zinc-700 max-w-xs`}
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                className="rounded-md bg-zinc-900 dark:bg-white px-4 text-sm font-medium text-white dark:text-zinc-900"
              >
                Застосувати
              </button>
            </div>
            {couponError && <p className="mt-2 text-xs text-red-500">{couponError}</p>}
            {appliedCoupon && (
              <p className="mt-2 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500">
                Купон {appliedCoupon.coupon.code} застосовано (−{formatPrice(discount)})
                <button type="button" onClick={removeCoupon} className="text-zinc-400 underline underline-offset-2">
                  прибрати
                </button>
              </p>
            )}
            <p className="mt-2 text-xs text-zinc-400">Спробуйте демо-коди: SINSERITA10 або YARN50</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_420px]">
        {/* Left: contacts + delivery */}
        <div>
          <h2 className="text-lg font-semibold uppercase tracking-wide">Контактні дані</h2>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm">
                Імʼя <span className="text-red-500">*</span>
              </label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className={`${inputBase} ${errCls("firstName")}`} />
              {errors.firstName && <p className="mt-1 text-xs text-red-500">{errors.firstName}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm">
                Прізвище <span className="text-red-500">*</span>
              </label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" className={`${inputBase} ${errCls("lastName")}`} />
              {errors.lastName && <p className="mt-1 text-xs text-red-500">{errors.lastName}</p>}
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm">
              Телефон <span className="text-red-500">*</span>
            </label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+380" className={`${inputBase} ${errCls("phone")}`} />
            {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm">
              E-mail адреса <span className="text-red-500">*</span>
            </label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" className={`${inputBase} ${errCls("email")}`} />
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
          </div>

          <h2 className="mt-10 text-lg font-semibold uppercase tracking-wide">Доставка</h2>

          <div className="mt-5 space-y-2" role="radiogroup" aria-label="Спосіб доставки">
            {DELIVERY_METHODS.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors ${
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
                  {m.label}
                </span>
                <span className="text-xs text-zinc-500">{m.hint}</span>
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
              <>
                <div>
                  <label className="mb-1.5 block text-sm">
                    Населений пункт <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={delivery.city?.name ?? ""}
                    onChange={(e) => patchDelivery({ city: { name: e.target.value } })}
                    placeholder="Наприклад: Хмельницький"
                    className={`${inputBase} ${errCls("city")}`}
                  />
                  {errors.city && <p className="mt-1 text-xs text-red-500">{errors.city}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm">
                    Відділення Укрпошти <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={delivery.point?.name ?? ""}
                    onChange={(e) => patchDelivery({ point: { name: e.target.value } })}
                    placeholder="Індекс або номер відділення"
                    className={`${inputBase} ${errCls("point")}`}
                  />
                  {errors.point && <p className="mt-1 text-xs text-red-500">{errors.point}</p>}
                </div>
              </>
            )}

            {delivery.method === "pickup" && (
              <div className="space-y-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                  {PICKUP_POINT.address}
                </p>
                <p className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                  {PICKUP_POINT.hours}
                </p>
                <p className="text-xs text-zinc-500">Ми зателефонуємо, коли замовлення буде готове до видачі.</p>
              </div>
            )}
          </div>

          <div className="mt-6">
            <label className="mb-1.5 block text-sm">Нотатки до замовлення (необовʼязково)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Нотатки до вашого замовлення, наприклад особливі побажання щодо доставки."
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
              <span>Проміжний підсумок</span>
            </div>

            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {cart.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 py-3 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {item.name} <span className="text-zinc-400">× {item.quantity}</span>
                  </span>
                  <span className="whitespace-nowrap">{formatPrice(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>

            <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 py-3 text-sm font-medium">
              <span>Проміжний підсумок</span>
              <span>{formatPrice(total)}</span>
            </div>

            {appliedCoupon && discount > 0 && (
              <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 py-3 text-sm font-medium text-emerald-600 dark:text-emerald-500">
                <span>Знижка ({appliedCoupon.coupon.code})</span>
                <span>−{formatPrice(discount)}</span>
              </div>
            )}

            <div className="flex justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 py-3 text-sm">
              <span className="font-medium">Доставка</span>
              <span className="text-right text-zinc-500">{deliveryHint}</span>
            </div>

            <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 text-base font-semibold">
              <span>Загалом</span>
              <span>{formatPrice(grandTotal)}</span>
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
                    className={`flex items-start gap-2 text-sm font-medium ${disabled ? "cursor-not-allowed text-zinc-400" : "cursor-pointer"}`}
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
              {effectivePayment === "card" && <p>Оплата карткою онлайн після підтвердження замовлення.</p>}
              {effectivePayment === "cod" && (
                <p>Передоплата онлайн, решта — при отриманні у відділенні (плюс комісія перевізника за накладений платіж).</p>
              )}
              {effectivePayment === "on_pickup" && <p>Оплата готівкою або карткою в магазині під час отримання.</p>}
              {split.now > 0 && (
                <p className="flex justify-between font-medium text-zinc-800 dark:text-zinc-200">
                  <span>До сплати зараз</span>
                  <span>{formatPrice(split.now)}</span>
                </p>
              )}
              {split.onReceipt > 0 && (
                <p className="flex justify-between font-medium text-zinc-800 dark:text-zinc-200">
                  <span>При отриманні</span>
                  <span>{formatPrice(split.onReceipt)}</span>
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

            <button
              type="submit"
              className="mt-4 w-full rounded-md bg-zinc-900 dark:bg-white py-3 text-sm font-semibold uppercase tracking-wide text-white dark:text-zinc-900 transition-colors hover:bg-zinc-800 dark:hover:bg-zinc-100"
            >
              Підтвердити замовлення
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
