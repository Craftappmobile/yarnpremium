"use client"

import { Search, ShoppingBag, X, SlidersHorizontal, Heart } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useWishlist } from "./wishlist-context"

interface TopBarProps {
  cartItemCount: number
  onCartClick: () => void
  /**
   * The catalog filters the list as people type (`searchQuery` + `onSearch`).
   * Other pages leave these out: Enter opens the catalog with the search.
   */
  searchQuery?: string
  onSearch?: (query: string) => void
  /** Quick-access category pills; other pages show no pills. */
  categories?: {
    popular: string[]
    selected: string[]
    onToggle: (category: string) => void
    onClear: () => void
    onShowAll: () => void
  }
}

export function TopBar({ cartItemCount, onCartClick, searchQuery, onSearch, categories }: TopBarProps) {
  const router = useRouter()
  const [isSearchOpen, setIsSearchOpen] = useState(Boolean(searchQuery))
  const [draft, setDraft] = useState("")
  const query = onSearch ? (searchQuery ?? "") : draft
  const setQuery = onSearch ?? setDraft
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

  // A search arriving from the URL (?q=) opens the search field.
  useEffect(() => {
    if (searchQuery) setIsSearchOpen(true)
  }, [searchQuery])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !onSearch && draft.trim()) {
      router.push(`/?q=${encodeURIComponent(draft.trim())}`)
    }
    if (e.key === "Escape") {
      setIsSearchOpen(false)
      searchInputRef.current?.blur()
    }
  }

  return (
    <header
      className={`sticky top-0 z-30 transition-shadow duration-200 ${
        isScrolled ? "bg-white shadow-sm dark:bg-zinc-900" : "bg-white dark:bg-zinc-900"
      } border-b border-zinc-200 dark:border-zinc-800`}
    >
      <div className="flex items-center justify-between gap-2 px-3 lg:px-6 h-14 lg:h-16">
        <Link
          href="/"
          className="text-sm lg:text-lg font-semibold uppercase tracking-[0.15em] lg:tracking-[0.2em] text-zinc-900 dark:text-zinc-100 shrink-0"
        >
          SINCERITA
        </Link>
        {categories ? (
          <div
            className={`flex-1 min-w-0 lg:px-2 items-center justify-center gap-2 ${
              // Phones: only the "all categories" button; it makes room for an open search.
              isSearchOpen ? "hidden lg:flex" : "flex"
            }`}
          >
            {/* The quick-access pills don't fit a phone: there the button opens the full list. */}
            <div className="hidden lg:flex min-w-0 items-center gap-1 pl-4 pr-8 overflow-x-auto overscroll-x-contain scrollbar-none [mask-image:linear-gradient(to_right,transparent,#000_16px,#000_calc(100%-32px),transparent)]">
            <button
              type="button"
              onClick={categories.onClear}
              aria-pressed={categories.selected.length === 0}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[15px] transition-colors ${
                categories.selected.length === 0
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              Всі
            </button>
            {categories.popular.map((category) => {
              const active = categories.selected.includes(category)
              return (
                <button
                  type="button"
                  key={category}
                  onClick={() => categories.onToggle(category)}
                  aria-pressed={active}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[15px] transition-colors ${
                    active
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {category}
                </button>
              )
            })}
            </div>
            <button
              type="button"
              onClick={categories.onShowAll}
              className="shrink-0 whitespace-nowrap flex items-center gap-1.5 lg:gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-2 lg:px-4 text-sm lg:text-[15px] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Всі категорії
              {/* Phones don't show the pills, so the button tells how many are picked. */}
              {categories.selected.length > 0 && (
                <span className="lg:hidden min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-medium tabular-nums">
                  {categories.selected.length}
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex items-center lg:gap-0.5 shrink-0">
          {isSearchOpen && (
            <div className="relative animate-in fade-in slide-in-from-right-2 duration-150 ease-out motion-reduce:animate-none">
              <input
                ref={searchInputRef}
                // Opened by a deliberate click on the search icon.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                type="search"
                enterKeyHint="search"
                placeholder="Назва, колір, артикул…"
                aria-label="Пошук товарів"
                className="w-32 min-[400px]:w-40 sm:w-56 lg:w-64 bg-zinc-100 dark:bg-zinc-800 rounded-md text-sm lg:text-[15px] pl-3 pr-8 py-2 text-zinc-800 dark:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyPress}
              />
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false)
                  setQuery("")
                }}
                aria-label="Закрити пошук"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-600 dark:text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            aria-label="Пошук"
            className={`p-2 lg:p-2.5 rounded-md transition-colors text-zinc-700 dark:text-zinc-300 ${
              isSearchOpen ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <Search className="w-[18px] h-[18px] lg:w-5 lg:h-5" />
          </button>
          <Link
            href="/wishlist"
            aria-label={wishlistCount > 0 ? `Список бажань: ${wishlistCount}` : "Список бажань"}
            className="p-2 lg:p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md relative text-zinc-700 dark:text-zinc-300"
          >
            <Heart className="w-[18px] h-[18px] lg:w-5 lg:h-5" />
            {wishlistCount > 0 && (
              <span className="animate-in zoom-in-50 duration-200 motion-reduce:animate-none absolute top-0.5 right-0.5 bg-rose-600 text-white text-xs font-medium tabular-nums w-4 h-4 flex items-center justify-center rounded-full">
                {wishlistCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={onCartClick}
            aria-label={cartItemCount > 0 ? `Кошик: ${cartItemCount}` : "Кошик"}
            className="p-2 lg:p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md relative text-zinc-700 dark:text-zinc-300"
          >
            <ShoppingBag className="w-[18px] h-[18px] lg:w-5 lg:h-5" />
            {cartItemCount > 0 && (
              <span
                className="animate-in zoom-in-50 duration-200 motion-reduce:animate-none absolute top-0.5 right-0.5 bg-zinc-900 dark:bg-white 
                                    text-white dark:text-zinc-900 text-xs font-medium tabular-nums w-4 h-4 
                                    flex items-center justify-center rounded-full"
              >
                {cartItemCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
