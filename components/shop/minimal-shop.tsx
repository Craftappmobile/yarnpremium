"use client"

import { AnimatePresence } from "motion/react"
import { SlidersHorizontal } from "lucide-react"
import { useReturnFocus } from "./use-return-focus"
import { useMemo, useState } from "react"
import { ProductGrid } from "./product-grid"
import { CartDrawer, CategoriesModal, MobileFiltersPanel, ProductModal, usePreloadDialogs } from "./lazy-dialogs"
import { TopBar } from "./top-bar"
import { FiltersSidebar, type Filters } from "./filters-sidebar"
import { Footer } from "./footer"
import { type Product, type SortOption, sortOptions, sortProducts, getFilterBounds, categoryCounts } from "./data"
import { useCart } from "./cart-context"
import { pluralUk } from "@/lib/utils"
import { type PackedCatalog, unpackCatalog } from "./catalog-pack"

/** Cards rendered at first and per "Показати ще" click; the catalog has thousands. */
const PAGE_SIZE = 60

export default function MinimalShop({ catalog }: { catalog: PackedCatalog }) {
  const products = useMemo(() => unpackCatalog(catalog), [catalog])
  const { cart, itemCount, addToCart } = useCart()
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [sort, setSort] = useState<SortOption>("default")

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  // Mounted on first open and kept, so the closing animation can play.
  const [filtersMounted, setFiltersMounted] = useState(false)
  const filtersReturnFocus = useReturnFocus()
  usePreloadDialogs()

  const { price: priceBounds, length: lengthBounds } = useMemo(() => getFilterBounds(products), [products])
  const popularCategories = useMemo(() => categoryCounts(products).slice(0, 8).map((c) => c.name), [products])

  const [filters, setFilters] = useState<Filters>({
    priceRange: priceBounds,
    lengthRange: lengthBounds,
    categories: [],
    colors: [],
  })

  const resetFilters = () => {
    setFilters({ priceRange: priceBounds, lengthRange: lengthBounds, categories: [], colors: [] })
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
    const matchesColor = filters.colors.length === 0 || filters.colors.includes(product.color)
    return matchesSearch && matchesPrice && matchesLength && matchesCategory && matchesColor
  })

  const sortedProducts = sortProducts(filteredProducts, sort)
  const activeFilterCount =
    filters.categories.length +
    filters.colors.length +
    (filters.priceRange[0] !== priceBounds[0] || filters.priceRange[1] !== priceBounds[1] ? 1 : 0) +
    (filters.lengthRange[0] !== lengthBounds[0] || filters.lengthRange[1] !== lengthBounds[1] ? 1 : 0)
  const shownProducts = sortedProducts.slice(0, visibleCount)

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
        popularCategories={popularCategories}
        onCartClick={() => setIsCartOpen(true)}
        onSearch={setSearchQuery}
        selectedCategories={filters.categories}
        onToggleCategory={toggleCategory}
        onClearCategories={clearCategories}
        onShowAllCategories={showAllCategories}
      />

      <div className="mx-auto max-w-[1400px] px-4 pt-6 lg:pt-12 pb-16">
        <h1 className="sr-only">SINCERITA — італійська пряжа преміум якості</h1>
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
          {/* Desktop: filters in a sidebar. Phones get them in a panel, so products come first. */}
          <div id="filters-sidebar" className="hidden lg:block lg:w-64 shrink-0">
            <div className="lg:sticky lg:top-16">
              <FiltersSidebar
                allProducts={products}
                priceBounds={priceBounds}
                lengthBounds={lengthBounds}
                filters={filters}
                onChange={setFilters}
                onReset={resetFilters}
              />
            </div>
          </div>

          {/* Phones: filters in a slide-in panel, loaded the first time it's opened. */}
          {filtersMounted && (
            <MobileFiltersPanel
              open={isFiltersOpen}
              onOpenChange={setIsFiltersOpen}
              returnFocus={filtersReturnFocus}
              resultLabel={`Показати ${sortedProducts.length} ${pluralUk(sortedProducts.length, ["товар", "товари", "товарів"])}`}
            >
              <FiltersSidebar
                allProducts={products}
                priceBounds={priceBounds}
                lengthBounds={lengthBounds}
                filters={filters}
                onChange={setFilters}
                onReset={resetFilters}
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
                  {sortedProducts.length} {pluralUk(sortedProducts.length, ["товар", "товари", "товарів"])}
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
            ) : sortedProducts.length > 0 ? (
              <>
                <ProductGrid products={shownProducts} onProductSelect={setSelectedProduct} />
                {sortedProducts.length > shownProducts.length && (
                  <div className="mt-8 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                      className="rounded-md border border-zinc-300 dark:border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Показати ще ({sortedProducts.length - shownProducts.length})
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
