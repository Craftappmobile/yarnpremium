"use client"

import { AnimatePresence } from "motion/react"
import { SlidersHorizontal } from "lucide-react"
import { useReturnFocus } from "./use-return-focus"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ProductGrid } from "./product-grid"
import { CartDrawer, CategoriesModal, MobileFiltersPanel, ProductModal, usePreloadDialogs } from "./lazy-dialogs"
import { TopBar } from "./top-bar"
import { FiltersSidebar, type Filters } from "./filters-sidebar"
import { Footer } from "./footer"
import { type Product, type SortOption, sortOptions, sortProducts } from "./data"
import { useCart } from "./cart-context"
import { pluralUk } from "@/lib/utils"
import { type PackedCatalog, unpackCatalog } from "./catalog-pack"
import { type CatalogSummary, FIRST_SCREEN } from "./catalog-summary"
import { matchesShade } from "./yarn-colors"

/** Cards per "Показати ще" click; the catalog has thousands. */
const PAGE_SIZE = 60

/**
 * The whole catalog, loaded on the visitor's first touch, scroll or key
 * press (or when something asks for it): the first screen doesn't need it,
 * and unpacking thousands of products while a phone is still showing the
 * page would hold the page up. Null until it arrives.
 */
function useFullCatalog(): [Product[] | null, () => void] {
  const [full, setFull] = useState<Product[] | null>(null)
  const requested = useRef(false)
  const request = useCallback(() => {
    if (requested.current) return
    requested.current = true
    const load = (attempt: number) =>
      fetch("/api/catalog/packed")
        .then((res) => (res.ok ? (res.json() as Promise<PackedCatalog>) : Promise.reject(new Error(String(res.status)))))
        .then((packed) => setFull(unpackCatalog(packed)))
        .catch(() => {
          // One more try a little later; meanwhile the first screen stays usable.
          if (attempt === 0) setTimeout(() => load(1), 3000)
          else requested.current = false
        })
    load(0)
  }, [])
  useEffect(() => {
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const
    const onFirst = () => {
      request()
      for (const e of events) window.removeEventListener(e, onFirst)
    }
    for (const e of events) window.addEventListener(e, onFirst, { passive: true, once: true })
    return () => {
      for (const e of events) window.removeEventListener(e, onFirst)
    }
  }, [request])
  return [full, request]
}

export default function MinimalShop({ initial, summary }: { initial: PackedCatalog; summary: CatalogSummary }) {
  const firstScreen = useMemo(() => unpackCatalog(initial), [initial])
  const [full, requestFull] = useFullCatalog()
  const complete = full !== null
  const products = full ?? firstScreen
  const { cart, itemCount, addToCart } = useCart()
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [sort, setSort] = useState<SortOption>("default")

  const [visibleCount, setVisibleCount] = useState(FIRST_SCREEN)
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  // Mounted on first open and kept, so the closing animation can play.
  const [filtersMounted, setFiltersMounted] = useState(false)
  const filtersReturnFocus = useReturnFocus()
  usePreloadDialogs()

  // From the summary, so the filters are right before the full catalog arrives.
  const { priceBounds, lengthBounds } = summary
  const popularCategories = summary.categories.slice(0, 8)

  const [filters, setFilters] = useState<Filters>({
    priceRange: priceBounds,
    lengthRange: lengthBounds,
    categories: [],
    colorFamilies: [],
    shade: null,
  })

  // «Показати» under the colour wheel: the panel closes
  // on a phone, and the page goes to the products.
  const showResults = () => {
    setIsFiltersOpen(false)
    // After the panel has closed and handed focus back.
    setTimeout(() => document.getElementById("content")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250)
  }

  const resetFilters = () => {
    setFilters({ priceRange: priceBounds, lengthRange: lengthBounds, categories: [], colorFamilies: [], shade: null })
  }

  const toggleCategory = (category: string) => {
    setFilters((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category],
    }))
  }

  const clearCategories = () => {
    setFilters((prev) => ({ ...prev, categories: [] }))
  }

  // Other pages link here with ?q= (header search) or ?category= (breadcrumbs).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get("q")?.trim()
    const category = params.get("category")
    if (q) setSearchQuery(q)
    if (category && summary.categories.includes(category)) {
      setFilters((prev) => ({ ...prev, categories: [category] }))
    }
    if (q || category) {
      requestFull()
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [summary, requestFull])

  const showAllCategories = () => {
    setIsCategoriesOpen(true)
  }

  const query = searchQuery.trim().toLowerCase()
  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      !query ||
      [product.name, product.sku, product.color, product.brand, product.article].some((v) => v.toLowerCase().includes(query))
    const matchesPrice = product.price >= filters.priceRange[0] && product.price <= filters.priceRange[1]
    const matchesLength = product.length >= filters.lengthRange[0] && product.length <= filters.lengthRange[1]
    const matchesCategory = filters.categories.length === 0 || filters.categories.includes(product.category)
    const anyColor = filters.colorFamilies.length === 0 && !filters.shade
    const matchesColor =
      anyColor ||
      (product.colorFamily !== undefined && filters.colorFamilies.includes(product.colorFamily)) ||
      (filters.shade !== null && matchesShade(product, filters.shade))
    return matchesSearch && matchesPrice && matchesLength && matchesCategory && matchesColor
  })

  const sortedProducts = sortProducts(filteredProducts, sort)
  const activeFilterCount =
    filters.categories.length +
    filters.colorFamilies.length +
    (filters.shade ? 1 : 0) +
    (filters.priceRange[0] !== priceBounds[0] || filters.priceRange[1] !== priceBounds[1] ? 1 : 0) +
    (filters.lengthRange[0] !== lengthBounds[0] || filters.lengthRange[1] !== lengthBounds[1] ? 1 : 0)
  const shownProducts = sortedProducts.slice(0, visibleCount)
  // Search, filters and sorting need the whole catalog: until it's here they wait.
  const narrowed = query !== "" || activeFilterCount > 0 || sort !== "default"
  const waiting = !complete && narrowed
  const resultCount = complete ? sortedProducts.length : summary.total
  // More to show: counted over the whole catalog, also before it has loaded.
  const remaining = resultCount - shownProducts.length
  const showMore = () => {
    requestFull()
    setVisibleCount((n) => n + PAGE_SIZE)
  }

  // A new search, filter or sort starts from the top of the list again.
  const listKey = JSON.stringify([query, filters, sort])
  const [lastListKey, setLastListKey] = useState(listKey)
  if (listKey !== lastListKey) {
    setLastListKey(listKey)
    setVisibleCount(PAGE_SIZE)
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <TopBar
        cartItemCount={itemCount}
        onCartClick={() => setIsCartOpen(true)}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        categories={{
          popular: popularCategories,
          selected: filters.categories,
          onToggle: toggleCategory,
          onClear: clearCategories,
          onShowAll: showAllCategories,
        }}
      />

      <div className="mx-auto max-w-[1400px] px-4 pt-6 lg:pt-12 pb-16">
        <h1 className="sr-only">SINCERITA — італійська пряжа преміум якості</h1>
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
          {/* Desktop: filters in a sidebar. Phones get them in a panel, so products come first. */}
          <div id="filters-sidebar" className="hidden lg:block lg:w-64 shrink-0">
            <div className="lg:sticky lg:top-24">
              <FiltersSidebar
                allProducts={products}
                priceBounds={priceBounds}
                lengthBounds={lengthBounds}
                filters={filters}
                onChange={setFilters}
                onReset={resetFilters}
                onShowResults={showResults}
              />
            </div>
          </div>

          {/* Phones: filters in a slide-in panel, loaded the first time it's opened. */}
          {filtersMounted && (
            <MobileFiltersPanel
              open={isFiltersOpen}
              onOpenChange={setIsFiltersOpen}
              returnFocus={filtersReturnFocus}
              resultLabel={
                waiting ? "Показати" : `Показати ${resultCount} ${pluralUk(resultCount, ["товар", "товари", "товарів"])}`
              }
            >
              <FiltersSidebar
                allProducts={products}
                priceBounds={priceBounds}
                lengthBounds={lengthBounds}
                filters={filters}
                onChange={setFilters}
                onReset={resetFilters}
                onShowResults={showResults}
                showTitle={false}
              />
            </MobileFiltersPanel>
          )}

          <div id="content" className="flex-1 min-w-0 scroll-mt-20">
            <h2 className="sr-only">Товари</h2>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setFiltersMounted(true)
                    setIsFiltersOpen(true)
                  }}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 lg:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Фільтри
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-zinc-900 px-1.5 text-xs tabular-nums text-white">{activeFilterCount}</span>
                  )}
                </button>
                <p role="status" className="text-xs tabular-nums whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                  {waiting ? "Шукаємо…" : `${resultCount} ${pluralUk(resultCount, ["товар", "товари", "товарів"])}`}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="hidden sm:inline">Сортувати:</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  aria-label="Сортувати"
                  className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-800 dark:text-zinc-200"
                >
                  {sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Каталог оновлюється. Зазирніть за кілька хвилин.</p>
              </div>
            ) : waiting ? (
              <div className="flex flex-col items-center justify-center py-24 text-center" aria-busy="true">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Завантажуємо весь каталог…</p>
              </div>
            ) : sortedProducts.length > 0 ? (
              <>
                <ProductGrid products={shownProducts} onProductSelect={setSelectedProduct} />
                {remaining > 0 && (
                  <div className="mt-8 flex justify-center">
                    <button
                      type="button"
                      onClick={showMore}
                      disabled={!complete && visibleCount > FIRST_SCREEN}
                      className="rounded-md border border-zinc-300 dark:border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:cursor-wait disabled:opacity-60"
                    >
                      {!complete && visibleCount > FIRST_SCREEN ? "Завантажуємо…" : `Показати ще (${remaining})`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Немає товарів за вибраними фільтрами.</p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 text-xs font-medium text-zinc-900 dark:text-zinc-100 underline underline-offset-4"
                >
                  Скинути фільтри
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onAddToCart={(product, quantity) => {
              addToCart(product, quantity)
              setSelectedProduct(null)
              setIsCartOpen(true)
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCartOpen && (
          <CartDrawer onClose={() => setIsCartOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCategoriesOpen && (
          <CategoriesModal
            allProducts={products}
            selectedCategories={filters.categories}
            onToggleCategory={toggleCategory}
            onClearCategories={clearCategories}
            onClose={() => setIsCategoriesOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
