"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import type { Product } from "./data"
import { isProductLike, lookupProducts } from "./catalog-client"
import { readStorage, writeStorage, parseStorageEvent } from "@/lib/storage"

// v2 stores product snapshots, refreshed from the catalog on load.
const WISHLIST_KEY = "sinserita:wishlist:v2"

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

function readSavedWishlist(saved: unknown): Product[] {
  return Array.isArray(saved) ? saved.filter(isProductLike) : []
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [wishlist, setWishlist] = useState<Product[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let active = true
    const saved = readSavedWishlist(readStorage(WISHLIST_KEY))
    setWishlist(saved)
    setHydrated(true)
    // Refresh against the catalog: withdrawn products are dropped, sold-out ones
    // stay (marked). Kept as saved when the catalog can't be reached.
    const checked = new Set(saved.map((p) => p.sku))
    lookupProducts([...checked]).then((current) => {
      if (active && current) {
        setWishlist((prev) => prev.flatMap((p) => (checked.has(p.sku) ? (current.get(p.sku) ?? []) : [p])))
      }
    })
    const onStorage = (e: StorageEvent) => {
      if (e.key === WISHLIST_KEY) setWishlist(readSavedWishlist(parseStorageEvent(e)))
    }
    window.addEventListener("storage", onStorage)
    return () => {
      active = false
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    if (hydrated) writeStorage(WISHLIST_KEY, wishlist)
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
