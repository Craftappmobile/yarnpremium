"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Minus, Plus, Search, X } from "lucide-react"
import {
  ADD_ON,
  type Product,
  addOnCap,
  clampQuantity,
  formatPrice,
  formatQuantity,
  priceAddOn,
  quantityRules,
  stepQuantity,
} from "./data"
import { type PackedCatalog, unpackCatalog } from "./catalog-pack"
import { lookupProducts } from "./catalog-client"
import type { LastOrder } from "./last-order"
import { trackAddToCart, trackPurchase } from "./analytics"
import { submitPaymentForm } from "./pay"
import { OldPrice } from "./promo-price"
import { ProductImage } from "./product-image"
import type { AddOnRequest, Order, StockChange } from "@/lib/order"

/** Cards shown before the buyer searches. */
const PICKS = 4
const RESULTS = 8
const LIST_NAME = "Доповнення до замовлення"

/** When the add-on offer for an order runs out (ms). */
export function addOnDeadline(order: Order): number {
  return Date.parse(order.createdAt) + ADD_ON.minutes * 60_000
}

/** Whether the confirmation page may still offer to add to this order. */
export function canOfferAddOn(last: LastOrder | null): boolean {
  if (!last || !last.order.number || last.order.addOnTo || last.addOn || last.addOnDeclined) return false
  return Date.now() < addOnDeadline(last.order)
}

interface Chosen {
  product: Product
  quantity: number
}

/**
 * «Додайте до замовлення» on the confirmation page (ADD_ON): a few picks for
 * the order — more of what was bought, from the same dye lot, and close
 * shades — and a search of the whole catalog. What is added goes in the same
 * parcel, at the add-on discount.
 */
export function AddOnOffer({
  last,
  onPlaced,
  onClose,
}: {
  last: LastOrder
  onPlaced: (addOn: { id: string; order: Order }) => void
  /** The buyer said no (`declined`) or the time ran out. */
  onClose: (declined: boolean) => void
}) {
  const { order } = last
  const deadline = addOnDeadline(order)
  const left = useCountdown(deadline)
  const [picks, setPicks] = useState<Product[]>([])
  const [catalog, setCatalog] = useState<Product[] | null>(null)
  const [query, setQuery] = useState("")
  const [chosen, setChosen] = useState<Chosen[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const catalogRequested = useRef(false)

  useEffect(() => {
    if (left <= 0 && !sending) onClose(false)
  }, [left, sending, onClose])

  // More of what was ordered first (the same dye lot, while it lasts), then close shades of the main yarn.
  useEffect(() => {
    let active = true
    const ordered = order.items.map((i) => i.sku)
    const main = [...order.items].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0]
    const params = new URLSearchParams({ sku: main.sku })
    for (const sku of ordered) params.append("skip", sku)
    Promise.all([
      lookupProducts(ordered),
      fetch(`/api/catalog/suggest?${params}`)
        .then((res) => (res.ok ? res.json() : { products: [] }))
        .then((data: { products?: Product[] }) => data.products ?? [])
        .catch(() => [] as Product[]),
    ]).then(([current, similar]) => {
      if (!active) return
      const same = ordered.flatMap((sku) => {
        const p = current?.get(sku)
        return p && p.stock > 0 ? [p] : []
      })
      setPicks([...same.slice(0, 2), ...similar].slice(0, PICKS))
    })
    return () => {
      active = false
    }
  }, [order.items])

  const loadCatalog = () => {
    if (catalogRequested.current) return
    catalogRequested.current = true
    fetch("/api/catalog/packed")
      .then((res) => (res.ok ? (res.json() as Promise<PackedCatalog>) : Promise.reject(new Error(String(res.status)))))
      .then((packed) => setCatalog(unpackCatalog(packed)))
      .catch(() => {
        catalogRequested.current = false
      })
  }

  const search = query.trim().toLowerCase()
  // Every word somewhere in the product: «мохер сірий» finds grey mohair.
  const results = useMemo(() => {
    const words = search.split(/\s+/).filter(Boolean)
    if (!catalog || words.length === 0) return []
    return catalog
      .filter((p) => {
        if (p.stock <= 0) return false
        const text = [p.name, p.sku, p.color, p.brand, p.article, p.category].join(" ").toLowerCase()
        return words.every((w) => text.includes(w))
      })
      .slice(0, RESULTS)
  }, [catalog, search])

  const priced = priceAddOn(chosen, order.total)
  const total = priced.reduce((sum, l) => sum + l.total, 0)
  const saved = priced.reduce((sum, l) => sum + l.saved, 0)
  const quantityOf = (sku: string) => chosen.find((c) => c.product.sku === sku)?.quantity

  const choose = (product: Product, quantity: number) => {
    setError("")
    if (chosen.some((c) => c.product.sku === product.sku)) {
      setChosen((prev) => prev.map((c) => (c.product.sku === product.sku ? { product, quantity } : c)))
      return
    }
    trackAddToCart(product, quantity, LIST_NAME)
    setChosen((prev) => [...prev, { product, quantity }])
  }
  const drop = (sku: string) => setChosen((prev) => prev.filter((c) => c.product.sku !== sku))

  const send = async () => {
    setSending(true)
    setError("")
    const request: AddOnRequest = {
      order: last.id,
      items: chosen.map((c) => ({ sku: c.product.sku, quantity: c.quantity })),
    }
    try {
      const res = await fetch("/api/orders/add-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(45_000),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.order) {
        trackPurchase(data.order as Order, data.id)
        onPlaced({ id: data.id, order: data.order })
        // Paid by card like the order: straight to WayForPay, which brings the buyer back here.
        if (data.payment) submitPaymentForm(data.payment)
        return
      }
      if (data.changes) {
        // Bring the choice in line with what is left; the buyer looks again before sending.
        const changes = data.changes as StockChange[]
        setChosen((prev) =>
          prev.flatMap((c) => {
            const change = changes.find((x) => x.sku === c.product.sku)
            if (!change) return [c]
            if (change.available <= 0) return []
            const product = { ...c.product, stock: change.available }
            return [{ product, quantity: clampQuantity(product, c.quantity) }]
          }),
        )
      }
      setError(data.error || "Не вдалося додати товари. Спробуйте ще раз.")
      if (res.status === 410 || res.status === 404) onClose(false)
    } catch {
      setError("Не вдалося звʼязатися з сервером. Перевірте інтернет і спробуйте ще раз.")
    }
    setSending(false)
  }

  const minutes = Math.floor(Math.max(0, left) / 60_000)
  const seconds = Math.floor((Math.max(0, left) % 60_000) / 1000)
  const card = order.payment.method === "card"
  const shown = search ? results : picks

  return (
    <section
      aria-labelledby="add-on-title"
      className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Ще встигаєте</p>
        <p className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium tabular-nums dark:bg-zinc-800" role="timer">
          {minutes}:{String(seconds).padStart(2, "0")}
        </p>
      </div>
      <h2 id="add-on-title" className="mt-2 text-xl font-semibold tracking-tight text-balance">
        Додайте до замовлення — на {ADD_ON.percent}% дешевше
      </h2>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        Будь-яка пряжа з каталогу. Відправимо однією посилкою з замовленням №{order.number}, без другої доставки.
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Знижка — до {formatPrice(addOnCap(order.total))}; акційні товари — за акційною ціною.
      </p>

      <label className="relative mt-4 block">
        <span className="sr-only">Пошук у каталозі</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={loadCatalog}
          placeholder="Пошук: назва, колір, бренд"
          className="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-9 pr-3 text-base sm:text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>

      <p className="mt-4 text-xs font-medium text-zinc-500 dark:text-zinc-400" aria-live="polite">
        {!search
          ? "Підібрали до вашого замовлення"
          : !catalog
            ? "Шукаємо…"
            : results.length === 0
              ? "Нічого не знайшли. Спробуйте інше слово."
              : "Знайдено"}
      </p>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
        {shown.map((p) => (
          <OfferRow
            key={p.sku}
            product={p}
            ordered={order.items.some((i) => i.sku === p.sku)}
            orderTotal={order.total}
            chosenQuantity={quantityOf(p.sku)}
            onChoose={(q) => choose(p, q)}
            onDrop={() => drop(p.sku)}
          />
        ))}
      </ul>

      {chosen.length > 0 && (
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
          <ul className="space-y-1.5 text-sm">
            {chosen.map((c, i) => (
              <li key={c.product.sku} className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-zinc-700 dark:text-zinc-300">
                  {c.product.name}{" "}
                  <span className="whitespace-nowrap text-zinc-500">× {formatQuantity(c.quantity, c.product.priceUnit)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                  {formatPrice(priced[i].total)}
                  <button
                    type="button"
                    onClick={() => drop(c.product.sku)}
                    aria-label={`Прибрати ${c.product.name}`}
                    className="rounded-full p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {saved > 0 && (
            <p className="mt-2 flex justify-between text-sm text-emerald-700 dark:text-emerald-500">
              <span>Економія</span>
              <span className="tabular-nums">−{formatPrice(saved)}</span>
            </p>
          )}
          <p className="mt-1 flex justify-between font-medium">
            <span>Разом</span>
            <span className="tabular-nums">{formatPrice(total)}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {card
              ? "Оплата карткою онлайн, як і замовлення."
              : order.payment.method === "cod"
                ? "Сплатите при отриманні разом із замовленням — без додаткової передоплати."
                : "Оплатите в магазині, коли заберете замовлення."}
          </p>
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="mt-3 w-full rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-zinc-900"
          >
            {sending
              ? "Додаємо…"
              : card
                ? `Додати й оплатити ${formatPrice(total)}`
                : `Додати до замовлення · ${formatPrice(total)}`}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => onClose(true)}
        className="mt-3 w-full py-2 text-sm text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400"
      >
        Ні, дякую
      </button>
    </section>
  )
}

function OfferRow({
  product: p,
  ordered,
  orderTotal,
  chosenQuantity,
  onChoose,
  onDrop,
}: {
  product: Product
  ordered: boolean
  orderTotal: number
  chosenQuantity?: number
  onChoose: (quantity: number) => void
  onDrop: () => void
}) {
  const [draft, setDraft] = useState(() => clampQuantity(p, p.minQty))
  const quantity = chosenQuantity ?? draft
  const { min, max } = quantityRules(p)
  const [line] = priceAddOn([{ product: p, quantity }], orderTotal)
  const change = (q: number) => (chosenQuantity === undefined ? setDraft(q) : onChoose(q))
  const showColor = p.color && !p.name.toLowerCase().includes(p.color.toLowerCase())

  return (
    <li className="flex gap-3 py-3">
      <ProductImage src={p.image} alt="" width={56} height={64} sizes="56px" className="h-16 w-14 shrink-0 rounded-md object-cover" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {ordered ? "Ще цього кольору — з тієї ж партії" : showColor ? p.color : null}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => change(stepQuantity(p, quantity, -1))}
              disabled={quantity <= min}
              aria-label={`Зменшити кількість: ${p.name}`}
              className="p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span className="min-w-14 px-1 text-center text-sm tabular-nums">{formatQuantity(quantity, p.priceUnit)}</span>
            <button
              type="button"
              onClick={() => change(stepQuantity(p, quantity, 1))}
              disabled={quantity >= max}
              aria-label={`Збільшити кількість: ${p.name}`}
              className="p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <p className="text-right text-sm tabular-nums">
            <span className="font-semibold">{formatPrice(line.total)}</span>
            {line.saved > 0 && <OldPrice className="ml-1 text-xs">{formatPrice(line.total + line.saved)}</OldPrice>}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-start">
        {chosenQuantity === undefined ? (
          <button
            type="button"
            onClick={() => onChoose(quantity)}
            aria-label={`Додати ${formatQuantity(quantity, p.priceUnit)} ${p.name}`}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Додати
          </button>
        ) : (
          <button
            type="button"
            onClick={onDrop}
            aria-label={`Прибрати ${p.name}`}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-2 text-xs font-semibold dark:border-zinc-600"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            Додано
          </button>
        )}
      </div>
    </li>
  )
}

/** Milliseconds left until `deadline`, updated every second. */
function useCountdown(deadline: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return deadline - now
}
