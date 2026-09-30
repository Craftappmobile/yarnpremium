"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { type Product, type CartItem, getProductById } from "./data"
import { readStorage, writeStorage, parseStorageEvent } from "@/lib/storage"

const CART_KEY = "sinserita:cart:v1"

interface CartContextValue {
  cart: CartItem[]
  itemCount: number
  total: number
  /** False until the saved cart has been restored from localStorage. */
  hydrated: boolean
  addToCart: (product: Product, quantity?: number) => void
  removeFromCart: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

/**
 * Rebuilds the cart from saved `{ id, quantity }` pairs using the current
 * catalog, so prices and stock are always fresh: unknown or sold-out products
 * are dropped and quantities are clamped to what is in stock.
 */
function restoreCart(saved: unknown): CartItem[] {
  if (!Array.isArray(saved)) return []
  return saved.flatMap((entry) => {
    if (!entry || typeof entry.id !== "string" || typeof entry.quantity !== "number") return []
    const product = getProductById(entry.id)
    if (!product || product.stock <= 0) return []
    return [{ ...product, quantity: Math.min(Math.max(1, Math.floor(entry.quantity)), product.stock) }]
  })
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  // Restore after mount (localStorage is browser-only) and follow changes
  // made in other tabs.
  useEffect(() => {
    setCart(restoreCart(readStorage(CART_KEY)))
    setHydrated(true)
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_KEY) setCart(restoreCart(parseStorageEvent(e)))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  // Only persist once restored, so the initial empty state never overwrites a saved cart.
  useEffect(() => {
    if (hydrated) writeStorage(CART_KEY, cart.map(({ id, quantity }) => ({ id, quantity })))
  }, [cart, hydrated])

  const addToCart = useCallback((product: Product, quantity = 1) => {
    if (product.stock <= 0) return
    setCart((prev) => {
      const exists = prev.find((item) => item.id === product.id)
      if (exists) {
        // Never let the cart quantity exceed available stock.
        const nextQty = Math.min(exists.quantity + quantity, product.stock)
        return prev.map((item) => (item.id === product.id ? { ...item, quantity: nextQty } : item))
      }
      return [...prev, { ...product, quantity: Math.min(quantity, product.stock) }]
    })
  }, [])

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== productId))
  }, [])

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === productId ? { ...item, quantity: Math.min(Math.max(1, quantity), item.stock) } : item))
        .filter((item) => item.quantity > 0),
    )
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  return (
    <CartContext.Provider
      value={{ cart, itemCount, total, hydrated, addToCart, removeFromCart, updateQuantity, clearCart }}
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
