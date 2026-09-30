"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { type Product } from "./data"

interface WishlistContextValue {
  wishlist: Product[]
  count: number
  isWishlisted: (productId: string) => boolean
  toggleWishlist: (product: Product) => void
  removeFromWishlist: (productId: string) => void
}

const WishlistContext = createContext<WishlistContextValue | null>(null)

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [wishlist, setWishlist] = useState<Product[]>([])

  const isWishlisted = useCallback((productId: string) => wishlist.some((p) => p.id === productId), [wishlist])

  const toggleWishlist = useCallback((product: Product) => {
    setWishlist((prev) =>
      prev.some((p) => p.id === product.id) ? prev.filter((p) => p.id !== product.id) : [...prev, product],
    )
  }, [])

  const removeFromWishlist = useCallback((productId: string) => {
    setWishlist((prev) => prev.filter((p) => p.id !== productId))
  }, [])

  return (
    <WishlistContext.Provider
      value={{ wishlist, count: wishlist.length, isWishlisted, toggleWishlist, removeFromWishlist }}
    >
      {children}
    </WishlistContext.Provider>
  )
}

export function useWishlist() {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error("useWishlist must be used within a WishlistProvider")
  return ctx
}
