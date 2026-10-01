"use client"

import { Search, ShoppingBag, X, SlidersHorizontal, Heart } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { motion } from "motion/react"
import Link from "next/link"
import { useWishlist } from "./wishlist-context"

interface TopBarProps {
  cartItemCount: number
  /** Quick-access category pills. */
  popularCategories: string[]
  onCartClick: () => void
  onSearch: (query: string) => void
  selectedCategories: string[]
  onToggleCategory: (category: string) => void
  onClearCategories: () => void
  onShowAllCategories: () => void
}

export function TopBar({
  cartItemCount,
  popularCategories,
  onCartClick,
  onSearch,
  selectedCategories,
  onToggleCategory,
  onClearCategories,
  onShowAllCategories,
}: TopBarProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { count: wishlistCount } = useWishlist()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsSearchOpen(false)
      searchInputRef.current?.blur()
    }
  }

  return (
    <div
      className={`sticky top-0 z-30 transition-shadow duration-200 ${
        isScrolled ? "bg-white shadow-sm dark:bg-zinc-900" : "bg-white dark:bg-zinc-900"
      } border-b border-zinc-200 dark:border-zinc-800`}
    >
      <div className="flex items-center justify-between px-3 h-12">
        <Link
          href="/"
          className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-900 dark:text-zinc-100 shrink-0"
        >
          SINCERITA
        </Link>
        <div className="flex-1 min-w-0 px-4 flex items-center [justify-content:safe_center] gap-2 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={onClearCategories}
            aria-pressed={selectedCategories.length === 0}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors ${
              selectedCategories.length === 0
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            Всі
          </button>
          {popularCategories.map((category) => {
            const active = selectedCategories.includes(category)
            return (
              <button
                type="button"
                key={category}
                onClick={() => onToggleCategory(category)}
                aria-pressed={active}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {category}
              </button>
            )
          })}
          <button
            type="button"
            onClick={onShowAllCategories}
            className="shrink-0 whitespace-nowrap flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Всі категорії
          </button>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {isSearchOpen && (
            <motion.div
              className="relative"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              <input
                ref={searchInputRef}
                // Opened by a deliberate click on the search icon.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                type="search"
                enterKeyHint="search"
                placeholder="Назва, колір, артикул…"
                aria-label="Пошук товарів"
                className="w-40 sm:w-56 bg-zinc-100 dark:bg-zinc-800 rounded-md text-sm pl-3 pr-8 py-1.5 text-zinc-800 dark:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={handleKeyPress}
              />
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false)
                  onSearch("")
                }}
                aria-label="Закрити пошук"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-600 dark:text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
          <button
            type="button"
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            aria-label="Пошук"
            className={`p-2.5 rounded-md transition-colors text-zinc-700 dark:text-zinc-300 ${
              isSearchOpen ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <Search className="w-4 h-4" />
          </button>
          <Link
            href="/wishlist"
            aria-label={wishlistCount > 0 ? `Список бажань: ${wishlistCount}` : "Список бажань"}
            className="p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md relative text-zinc-700 dark:text-zinc-300"
          >
            <Heart className="w-4 h-4" />
            {wishlistCount > 0 && (
              <motion.span
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                className="absolute top-0.5 right-0.5 bg-rose-500 text-white text-xs font-medium tabular-nums w-4 h-4 flex items-center justify-center rounded-full"
              >
                {wishlistCount}
              </motion.span>
            )}
          </Link>
          <button
            type="button"
            onClick={onCartClick}
            aria-label={cartItemCount > 0 ? `Кошик: ${cartItemCount}` : "Кошик"}
            className="p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md relative text-zinc-700 dark:text-zinc-300"
          >
            <ShoppingBag className="w-4 h-4" />
            {cartItemCount > 0 && (
              <motion.span
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                className="absolute top-0.5 right-0.5 bg-zinc-900 dark:bg-white 
                                    text-white dark:text-zinc-900 text-xs font-medium tabular-nums w-4 h-4 
                                    flex items-center justify-center rounded-full"
              >
                {cartItemCount}
              </motion.span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

