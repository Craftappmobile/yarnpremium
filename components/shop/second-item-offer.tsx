"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { type CartItem, type Product, SECOND_ITEM, clampQuantity, formatPrice, formatQuantity, priceLines } from "./data"
import { useCart } from "./cart-context"
import { ProductImage } from "./product-image"
import { OldPrice } from "./promo-price"

const SHOWN = 4

/**
 * «Second colour» offer (SECOND_ITEM) in the cart. With one line it offers close shades that
 * would cost less than it, at their price as the second line; with two or
 * more it only says which line has the discount and why.
 */
export function SecondItemOffer() {
  const { cart, priced } = useCart()
  if (cart.length === 0) return null
  if (cart.length > 1) {
    // No line has it when the promotional prices are lower anyway.
    if (!priced.some((line) => line.second)) return null
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        {SECOND_ITEM.name}: знижку отримує друга за сумою позиція, від її звичайної ціни (якщо акційна ціна нижча,
        лишається акційна). Тому порядок, у якому ви додаєте пряжу, не важливий.
      </p>
    )
  }
  return <Suggestions first={cart[0]} />
}

function Suggestions({ first }: { first: CartItem }) {
  const { addToCart } = useCart()
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ sku: first.sku, skip: first.sku })
    fetch(`/api/catalog/suggest?${params}`)
      .then((res) => (res.ok ? res.json() : { products: [] }))
      .then((data: { products: Product[] }) => active && setProducts(data.products ?? []))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [first.sku])

  // Only shades that would be the cheaper line: the discount is then on the one being added.
  const offers = products
    .map((p) => {
      const quantity = clampQuantity(p, p.minQty)
      const [, line] = priceLines([
        { product: first, quantity: first.quantity },
        { product: p, quantity },
      ])
      return { p, quantity, line }
    })
    .filter(({ line }) => line.second)
    .slice(0, SHOWN)

  if (offers.length === 0) return null

  return (
    <section aria-labelledby="second-item-title" className="rounded-lg border border-emerald-200 p-3 dark:border-emerald-900">
      <h3 id="second-item-title" className="text-sm font-semibold">
        Другий колір — на {SECOND_ITEM.percent}% дешевше
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Знижка від звичайної ціни діє на другу, дешевшу позицію в кошику.
      </p>
      <ul className="mt-3 space-y-2">
        {offers.map(({ p, quantity, line }) => (
          <li key={p.sku} className="flex items-center gap-3">
            <Link
              href={`/product/${encodeURIComponent(p.sku)}`}
              className="block h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800"
            >
              <ProductImage src={p.image} alt={p.name} width={56} height={56} sizes="56px" className="h-full w-full object-cover" />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.color || p.name}</p>
              <p className="text-xs tabular-nums">
                {formatQuantity(quantity, p.priceUnit)} за <span className="font-semibold">{formatPrice(line.total)}</span>{" "}
                <OldPrice>{formatPrice(line.total + line.saved)}</OldPrice>
              </p>
            </div>
            <button
              type="button"
              onClick={() => addToCart(p, quantity, "second_item")}
              aria-label={`Додати ${formatQuantity(quantity, p.priceUnit)} ${p.name}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Додати
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
