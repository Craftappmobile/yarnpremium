"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { type Product, type CartItem, clampToBuyable, isValidQuantity, leftoverOffer, lineTotal } from "./data"
import { isProductLike, lookupProducts } from "./catalog-client"
import { readStorage, writeStorage, parseStorageEvent } from "@/lib/storage"

// v2 stores product snapshots, so the cart shows instantly and survives a catalog outage.
const CART_KEY = "sinserita:cart:v2"

interface CartContextValue {
  cart: CartItem[]
  /** Number of cart lines (quantities are grams for yarn, so they aren't summed). */
  itemCount: number
  total: number
  /** False until the saved cart has been restored from localStorage. */
  hydrated: boolean
  /** `tail`: grams of `quantity` taken as the discounted leftover offer. */
  addToCart: (product: Product, quantity?: number, tail?: number) => void
  removeFromCart: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
  /** Re-reads price and stock of every cart item from the catalog. */
  refresh: () => Promise<void>
}

const CartContext = createContext<CartContextValue | null>(null)

function readSavedCart(saved: unknown): CartItem[] {
  if (!Array.isArray(saved)) return []
  return saved
    .filter((e): e is CartItem => isProductLike(e) && typeof (e as CartItem).quantity === "number")
    .map((e) => (typeof e.tail === "number" && e.tail > 0 ? e : { ...e, tail: undefined }))
}

/**
 * The cart line for `quantity` of a product: as asked when it can be bought,
 * otherwise the nearest amount that can. An accepted leftover offer stays
 * accepted while the leftover is still offered and no bigger than agreed.
 */
function cartLine(product: Product, quantity: number, tail = 0): CartItem {
  if (tail > 0) {
    if (isValidQuantity(product, quantity, tail)) return { ...product, quantity, tail }
    const offer = leftoverOffer(product, quantity - tail)
    if (offer > 0 && offer <= tail && isValidQuantity(product, product.stock, offer)) {
      return { ...product, quantity: product.stock, tail: offer }
    }
  }
  return { ...product, quantity: clampToBuyable(product, tail > 0 ? quantity - tail : quantity), tail: undefined }
}

/**
 * Brings items up to date with the catalog: current prices and stock,
 * sold-out or withdrawn products dropped, quantities kept within the limits.
 */
function applyCatalog(items: CartItem[], checked: Set<string>, current: Map<string, Product>): CartItem[] {
  return items.flatMap((item) => {
    // Added after the lookup was sent: already current.
    if (!checked.has(item.sku)) return [item]
    const product = current.get(item.sku)
    if (!product || product.stock <= 0) return []
    return [cartLine(product, item.quantity, item.tail)]
  })
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [hydrated, setHydrated] = useState(false)
  const cartRef = useRef(cart)
  cartRef.current = cart

  // Restore after mount (localStorage is browser-only), refresh against the
  // catalog, and follow changes made in other tabs.
  useEffect(() => {
    let active = true
    const saved = readSavedCart(readStorage(CART_KEY))
    setCart(saved)
    setHydrated(true)
    // When the catalog can't be reached the saved items are kept as they are.
    const checked = new Set(saved.map((i) => i.sku))
    lookupProducts([...checked]).then((current) => {
      if (active && current) setCart((prev) => applyCatalog(prev, checked, current))
    })
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_KEY) setCart(readSavedCart(parseStorageEvent(e)))
    }
    window.addEventListener("storage", onStorage)
    return () => {
      active = false
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  // Only persist once restored, so the initial empty state never overwrites a saved cart.
  useEffect(() => {
    if (hydrated) writeStorage(CART_KEY, cart)
  }, [cart, hydrated])

  const addToCart = useCallback((product: Product, quantity = product.minQty, tail = 0) => {
    if (product.stock <= 0) return
    setCart((prev) => {
      const exists = prev.find((item) => item.id === product.id)
      if (!exists) return [...prev, cartLine(product, quantity, tail)]
      // Accepting the leftover takes the whole spool; otherwise add up, never past the stock.
      const next =
        tail > 0 ? cartLine(product, quantity, tail)
        : exists.tail ? cartLine(product, exists.quantity, exists.tail)
        : cartLine(product, exists.quantity + quantity)
      return prev.map((item) => (item.id === product.id ? next : item))
    })
  }, [])

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== productId))
  }, [])

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === productId ? cartLine(item, quantity) : item))
        .filter((item) => item.quantity > 0),
    )
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  const refresh = useCallback(async () => {
    const checked = new Set(cartRef.current.map((i) => i.sku))
    const current = await lookupProducts([...checked])
    if (current) setCart((prev) => applyCatalog(prev, checked, current))
  }, [])

  const itemCount = cart.length
  const total = cart.reduce((sum, item) => sum + lineTotal(item, item.quantity, item.tail), 0)

  return (
    <CartContext.Provider
      value={{ cart, itemCount, total, hydrated, addToCart, removeFromCart, updateQuantity, clearCart, refresh }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error("useCart must be used within a CartProvider")
  return ctx
}
