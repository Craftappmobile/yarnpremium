"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useCart } from "./cart-context"
import { clampQuantity, type Product } from "./data"

/**
 * The link's campaign tags (utm_*, and the click ids of ads), carried on to
 * checkout: Google Analytics loads after the page and reads the address it
 * finds then, so without them a purchase from Telegram counted as direct.
 */
function campaignQuery(): string {
  const tags = [...new URLSearchParams(window.location.search)].filter(([k]) => k.startsWith("utm_") || k === "fbclid" || k === "gclid")
  return tags.length ? `?${new URLSearchParams(tags)}` : ""
}

/**
 * Puts the products of a buy link (app/buy) into the cart and opens checkout.
 * A product already in the cart keeps the larger of the two amounts, so
 * opening the link twice doesn't double it.
 */
export function BuyLink({ items }: { items: { product: Product; quantity: number }[] }) {
  const { cart, hydrated, addToCart, updateQuantity } = useCart()
  const router = useRouter()
  const done = useRef(false)

  useEffect(() => {
    if (!hydrated || done.current) return
    done.current = true
    for (const { product, quantity } of items) {
      const inCart = cart.find((item) => item.sku === product.sku)
      if (!inCart) addToCart(product, quantity, "Посилання на покупку")
      else if (inCart.quantity < quantity) updateQuantity(product.sku, clampQuantity(product, quantity))
    }
    router.replace(`/checkout${campaignQuery()}`)
  }, [hydrated, cart, items, addToCart, updateQuantity, router])

  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-zinc-500" aria-busy="true">
      Додаємо в кошик…
    </div>
  )
}
