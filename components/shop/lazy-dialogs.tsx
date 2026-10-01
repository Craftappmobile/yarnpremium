"use client"

import dynamic from "next/dynamic"
import { useEffect } from "react"

// Dialogs aren't needed for the first paint, so their code loads separately.
const loadProductModal = () => import("./product-modal").then((m) => m.ProductModal)
const loadCartDrawer = () => import("./cart-drawer").then((m) => m.CartDrawer)
const loadCategoriesModal = () => import("./categories-modal").then((m) => m.CategoriesModal)
const loadMobileFilters = () => import("./mobile-filters-panel").then((m) => m.MobileFiltersPanel)

export const ProductModal = dynamic(loadProductModal, { ssr: false })
export const CartDrawer = dynamic(loadCartDrawer, { ssr: false })
export const CategoriesModal = dynamic(loadCategoriesModal, { ssr: false })
export const MobileFiltersPanel = dynamic(loadMobileFilters, { ssr: false })

/** Fetches the dialog code once the browser is idle, so the first open is instant. */
export function usePreloadDialogs() {
  useEffect(() => {
    const preload = () => {
      loadProductModal()
      loadCartDrawer()
      loadCategoriesModal()
      loadMobileFilters()
    }
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(preload, 2000)
    return () => clearTimeout(t)
  }, [])
}
