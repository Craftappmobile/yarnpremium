"use client"

import { AnimatePresence } from "motion/react"
import { useMemo, useState } from "react"
import { ProductGrid } from "./product-grid"
import { CartDrawer } from "./cart-drawer"
import { ProductModal } from "./product-modal"
import { TopBar } from "./top-bar"
import { FiltersSidebar, type Filters } from "./filters-sidebar"
import { CategoriesModal } from "./categories-modal"
import { Footer } from "./footer"
import { type Product, products, type SortOption, sortOptions, sortProducts, getFilterBounds } from "./data"
import { useCart } from "./cart-context"
import { pluralUk } from "@/lib/utils"

export default function MinimalShop() {
  const { cart, itemCount, addToCart } = useCart()
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [sort, setSort] = useState<SortOption>("default")

  const { price: priceBounds, length: lengthBounds } = useMemo(() => getFilterBounds(products), [])

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

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesPrice = product.price >= filters.priceRange[0] && product.price <= filters.priceRange[1]
    const matchesLength = product.length >= filters.lengthRange[0] && product.length <= filters.lengthRange[1]
    const matchesCategory = filters.categories.length === 0 || filters.categories.includes(product.category)
    const matchesColor = filters.colors.length === 0 || filters.colors.includes(product.color)
    return matchesSearch && matchesPrice && matchesLength && matchesCategory && matchesColor
  })

  const sortedProducts = sortProducts(filteredProducts, sort)

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <TopBar
        cartItemCount={itemCount}
        onCartClick={() => setIsCartOpen(true)}
        onSearch={setSearchQuery}
        selectedCategories={filters.categories}
        onToggleCategory={toggleCategory}
        onClearCategories={clearCategories}
        onShowAllCategories={showAllCategories}
      />

      <div className="mx-auto max-w-[1400px] px-4 pt-12 pb-16">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
          <div id="filters-sidebar" className="lg:w-64 shrink-0 scroll-mt-20">
            <div className="lg:sticky lg:top-6">
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

          <div className="flex-1 min-w-0">
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {sortedProducts.length} {pluralUk(sortedProducts.length, ["товар", "товари", "товарів"])}
              </p>
              <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="hidden sm:inline">Сортувати:</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-700"
                >
                  {sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {sortedProducts.length > 0 ? (
              <ProductGrid products={sortedProducts} onProductSelect={setSelectedProduct} />
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
