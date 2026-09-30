"use client"

import { useMemo, useState, useEffect } from "react"
import { motion } from "motion/react"
import { X, Search } from "lucide-react"
import { type Product, categoryList } from "./data"
import { pluralUk } from "@/lib/utils"

interface CategoriesModalProps {
  allProducts: Product[]
  selectedCategories: string[]
  onToggleCategory: (category: string) => void
  onClearCategories: () => void
  onClose: () => void
}

export function CategoriesModal({
  allProducts,
  selectedCategories,
  onToggleCategory,
  onClearCategories,
  onClose,
}: CategoriesModalProps) {
  const [query, setQuery] = useState("")

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const categoryCounts = useMemo(
    () =>
      allProducts.reduce<Record<string, number>>((acc, p) => {
        acc[p.category] = (acc[p.category] || 0) + 1
        return acc
      }, {}),
    [allProducts],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return categoryList.filter((c) => c.toLowerCase().includes(q))
  }, [query])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Закрити категорії"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Всі категорії"
        className="relative z-10 mt-8 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
            Всі категорії
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук категорії…"
              aria-label="Пошук категорії"
              className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:ring-zinc-600"
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {matches.length} {pluralUk(matches.length, ["категорія", "категорії", "категорій"])}
            </span>
            {selectedCategories.length > 0 && (
              <button
                type="button"
                onClick={onClearCategories}
                className="text-[11px] font-medium text-zinc-500 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Скинути ({selectedCategories.length})
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="mt-3 flex-1 overflow-y-auto px-5 pb-5">
          {matches.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">Нічого не знайдено</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {matches.map((category) => {
                const checked = selectedCategories.includes(category)
                const count = categoryCounts[category] ?? 0
                return (
                  <li key={category}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                          checked
                            ? "border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100"
                            : "border-zinc-300 dark:border-zinc-700"
                        }`}
                      >
                        {checked && (
                          <svg viewBox="0 0 12 12" className="h-3 w-3 text-white dark:text-zinc-900" fill="none">
                            <path
                              d="M2.5 6.5l2.5 2.5 4.5-5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleCategory(category)}
                        className="sr-only"
                      />
                      <span
                        className={`flex-1 truncate text-sm ${
                          checked
                            ? "font-medium text-zinc-900 dark:text-zinc-100"
                            : count === 0
                              ? "text-zinc-400 dark:text-zinc-600"
                              : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {category}
                      </span>
                      <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs tabular-nums text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                        {count}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Готово
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
