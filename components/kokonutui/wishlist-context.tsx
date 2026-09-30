"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { type Product, getProductById } from "./data"
import { readStorage, writeStorage, parseStorageEvent } from "@/lib/storage"

const WISHLIST_KEY = "sinserita:wishlist:v1"

interface WishlistContextValue {
  wishlist: Product[]
  count: number
  /** False until the saved wishlist has been restored from localStorage. */
  hydrated: boolean
  isWishlisted: (productId: string) => boolean
  toggleWishlist: (product: Product) => void
  removeFromWishlist: (productId: string) => void
}

const WishlistContext = createContext<WishlistContextValue | null>(null)

/** Rebuilds the wishlist from saved ids using the current catalog; unknown ids are dropped. */
function restoreWishlist(saved: unknown): Product[] {
  if (!Array.isArray(saved)) return []
  return saved.flatMap((id) => {
    const product = typeof id === "string" ? getProductById(id) : undefined
    return product ? [product] : []
  })
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [wishlist, setWishlist] = useState<Product[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setWishlist(restoreWishlist(readStorage(WISHLIST_KEY)))
    setHydrated(true)
    const onStorage = (e: StorageEvent) => {
      if (e.key === WISHLIST_KEY) setWishlist(restoreWishlist(parseStorageEvent(e)))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  useEffect(() => {
    if (hydrated) writeStorage(WISHLIST_KEY, wishlist.map((p) => p.id))
  }, [wishlist, hydrated])

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
      value={{ wishlist, count: wishlist.length, hydrated, isWishlisted, toggleWishlist, removeFromWishlist }}
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
