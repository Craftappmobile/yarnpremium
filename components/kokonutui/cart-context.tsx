"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { type Product, type CartItem } from "./data"

interface CartContextValue {
  cart: CartItem[]
  itemCount: number
  total: number
  addToCart: (product: Product, quantity?: number) => void
  removeFromCart: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([])

  const addToCart = useCallback((product: Product, quantity = 1) => {
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
      value={{ cart, itemCount, total, addToCart, removeFromCart, updateQuantity, clearCart }}
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
