"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useCart } from "./cart-context"
import { formatPrice, applyCoupon, type Coupon } from "./data"
import { NovaPoshtaSelect } from "./nova-poshta-select"

type ShippingMethod = "nova" | "pickup" | "ukr"
type PaymentMethod = "cod" | "card"

const SHIPPING: Record<ShippingMethod, { label: string; cost: number; needsBranch: boolean }> = {
  nova: { label: "Нова пошта", cost: 0, needsBranch: true },
  pickup: { label: "Самовивіз", cost: 0, needsBranch: false },
  ukr: { label: "Укрпошта", cost: 0, needsBranch: true },
}

export function Checkout() {
  const router = useRouter()
  const { cart, total, clearCart } = useCart()

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [city, setCity] = useState("")
  const [branch, setBranch] = useState("")
  const [notes, setNotes] = useState("")
  const [shipping, setShipping] = useState<ShippingMethod>("nova")
  const [payment, setPayment] = useState<PaymentMethod>("cod")
  const [showCoupon, setShowCoupon] = useState(false)
  const [coupon, setCoupon] = useState("")
  const [appliedCoupon, setAppliedCoupon] = useState<{ coupon: Coupon; discount: number } | null>(null)
  const [couponError, setCouponError] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Recompute the discount against the live subtotal so it stays valid if the
  // cart changes after a coupon was applied.
  const discount = appliedCoupon ? Math.min(appliedCoupon.discount, total) : 0
  const grandTotal = Math.max(0, total - discount) + SHIPPING[shipping].cost

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
    if (!/^[\d\s+()-]{7,}$/.test(phone.trim())) e.phone = "Вкажіть коректний телефон"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Вкажіть коректний email"
    if (SHIPPING[shipping].needsBranch) {
      if (!city.trim()) e.city = "Оберіть населений пункт"
      if (!branch.trim()) e.branch = "Оберіть відділення"
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    // No backend yet — show the thank-you screen and clear the cart.
    clearCart()
    router.push("/checkout/success")
  }

  const inputBase =
    "w-full rounded-md border bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-900 dark:focus:border-zinc-100"
  const errCls = (k: string) =>
    errors[k] ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"

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

      <form onSubmit={handleSubmit} className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_420px]">
        {/* Left: billing + delivery */}
        <div>
          <h2 className="text-lg font-semibold uppercase tracking-wide">Платіжні дані</h2>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm">
                Імʼя <span className="text-red-500">*</span>
              </label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`${inputBase} ${errCls("firstName")}`} />
              {errors.firstName && <p className="mt-1 text-xs text-red-500">{errors.firstName}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm">
                Прізвище <span className="text-red-500">*</span>
              </label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={`${inputBase} ${errCls("lastName")}`} />
              {errors.lastName && <p className="mt-1 text-xs text-red-500">{errors.lastName}</p>}
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm">
              Телефон <span className="text-red-500">*</span>
            </label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={`${inputBase} ${errCls("phone")}`} />
            {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm">
              E-mail адреса <span className="text-red-500">*</span>
            </label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" className={`${inputBase} ${errCls("email")}`} />
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
          </div>

          <h2 className="mt-8 text-lg font-semibold">Виберіть адресу доставки</h2>

          {SHIPPING[shipping].needsBranch && (
            <div className="mt-5 space-y-4">
              {shipping === "nova" ? (
                <NovaPoshtaSelect
                  city={city}
                  branch={branch}
                  onCityChange={setCity}
                  onBranchChange={setBranch}
                  cityError={errors.city}
                  branchError={errors.branch}
                  inputClass={inputBase}
                  cityErrCls={errCls("city")}
                  branchErrCls={errCls("branch")}
                />
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm">
                      Населений пункт <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Виберіть населений пункт"
                      className={`${inputBase} ${errCls("city")}`}
                    />
                    {errors.city && <p className="mt-1 text-xs text-red-500">{errors.city}</p>}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm">
                      Відділення <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="Виберіть відділення"
                      className={`${inputBase} ${errCls("branch")}`}
                    />
                    {errors.branch && <p className="mt-1 text-xs text-red-500">{errors.branch}</p>}
                  </div>
                </>
              )}
            </div>
          )}

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

        {/* Right: order summary */}
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

            {/* Shipping */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 py-3">
              <p className="mb-2 text-sm font-medium">Відправлення</p>
              <div className="space-y-2">
                {(Object.keys(SHIPPING) as ShippingMethod[]).map((key) => (
                  <label key={key} className="flex cursor-pointer items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="shipping"
                        checked={shipping === key}
                        onChange={() => setShipping(key)}
                        className="accent-zinc-900 dark:accent-white"
                      />
                      {SHIPPING[key].label}
                    </span>
                    <span className="text-zinc-500">
                      {SHIPPING[key].cost === 0 ? "—" : formatPrice(SHIPPING[key].cost)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 text-base font-semibold">
              <span>Загалом</span>
              <span>{formatPrice(grandTotal)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="radio"
                name="payment"
                checked={payment === "cod"}
                onChange={() => setPayment("cod")}
                className="accent-zinc-900 dark:accent-white"
              />
              Оплата при доставці
            </label>
            {payment === "cod" && (
              <p className="mt-2 rounded-md bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                Оплата готівкою або карткою при отриманні замовлення.
              </p>
            )}
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="radio"
                name="payment"
                checked={payment === "card"}
                onChange={() => setPayment("card")}
                className="accent-zinc-900 dark:accent-white"
              />
              Оплата банківською карткою
            </label>

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
