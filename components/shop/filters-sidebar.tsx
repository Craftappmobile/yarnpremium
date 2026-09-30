"use client"

import { useMemo, useState } from "react"
import { type Product, categoryList } from "./data"
import { getColorHex } from "./colors"

export interface Filters {
  priceRange: [number, number]
  lengthRange: [number, number]
  categories: string[]
  colors: string[]
}

interface FiltersSidebarProps {
  allProducts: Product[]
  priceBounds: [number, number]
  lengthBounds: [number, number]
  filters: Filters
  onChange: (filters: Filters) => void
  onReset: () => void
}

export function FiltersSidebar({
  allProducts,
  priceBounds,
  lengthBounds,
  filters,
  onChange,
  onReset,
}: FiltersSidebarProps) {
  const [minBound, maxBound] = priceBounds
  const [minPrice, maxPrice] = filters.priceRange
  const [minLenBound, maxLenBound] = lengthBounds
  const [minLength, maxLength] = filters.lengthRange
  const [categoryQuery, setCategoryQuery] = useState("")

  // Product counts per category (taxonomy comes from categoryList)
  const categoryCounts = useMemo(
    () =>
      allProducts.reduce<Record<string, number>>((acc, p) => {
        acc[p.category] = (acc[p.category] || 0) + 1
        return acc
      }, {}),
    [allProducts],
  )

  // Full taxonomy, filtered by the in-panel search, with selected pinned to top
  const visibleCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase()
    const matches = categoryList.filter((c) => c.toLowerCase().includes(q))
    const selected = matches.filter((c) => filters.categories.includes(c))
    const rest = matches.filter((c) => !filters.categories.includes(c))
    return { selected, rest, total: matches.length }
  }, [categoryQuery, filters.categories])

  // Distinct colors with counts + hex
  const colorMap = allProducts.reduce<Record<string, { count: number; hex: string }>>((acc, p) => {
    if (!acc[p.color]) acc[p.color] = { count: 0, hex: getColorHex(p.color) }
    acc[p.color].count += 1
    return acc
  }, {})
  const colors = Object.keys(colorMap).sort()

  const isFiltered =
    minPrice !== minBound ||
    maxPrice !== maxBound ||
    minLength !== minLenBound ||
    maxLength !== maxLenBound ||
    filters.categories.length > 0 ||
    filters.colors.length > 0

  const setMin = (value: number) => {
    const clamped = Math.min(value, maxPrice)
    onChange({ ...filters, priceRange: [clamped, maxPrice] })
  }

  const setMax = (value: number) => {
    const clamped = Math.max(value, minPrice)
    onChange({ ...filters, priceRange: [minPrice, clamped] })
  }

  const setMinLength = (value: number) => {
    const clamped = Math.min(value, maxLength)
    onChange({ ...filters, lengthRange: [clamped, maxLength] })
  }

  const setMaxLength = (value: number) => {
    const clamped = Math.max(value, minLength)
    onChange({ ...filters, lengthRange: [minLength, clamped] })
  }

  const toggleCategory = (category: string) => {
    const next = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category]
    onChange({ ...filters, categories: next })
  }

  const toggleColor = (color: string) => {
    const next = filters.colors.includes(color)
      ? filters.colors.filter((c) => c !== color)
      : [...filters.colors, color]
    onChange({ ...filters, colors: next })
  }

  const range = maxBound - minBound || 1
  const minPercent = ((minPrice - minBound) / range) * 100
  const maxPercent = ((maxPrice - minBound) / range) * 100

  const lenRange = maxLenBound - minLenBound || 1
  const minLenPercent = ((minLength - minLenBound) / lenRange) * 100
  const maxLenPercent = ((maxLength - minLenBound) / lenRange) * 100

  return (
    <aside className="w-full space-y-10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">Фільтри</h2>
        {isFiltered && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            Скинути все
          </button>
        )}
      </div>

      {/* Price filter */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Фільтр за ціною
        </h3>

        <div className="relative h-6 flex items-center">
          <div className="absolute inset-x-0 h-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div
            className="absolute h-0.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
            style={{ left: `${minPercent}%`, right: `${100 - maxPercent}%` }}
          />
          <input
            type="range"
            min={minBound}
            max={maxBound}
            value={minPrice}
            onChange={(e) => setMin(Number(e.target.value))}
            aria-label="Мінімальна ціна"
            className="range-thumb absolute inset-x-0 w-full appearance-none bg-transparent pointer-events-none"
          />
          <input
            type="range"
            min={minBound}
            max={maxBound}
            value={maxPrice}
            onChange={(e) => setMax(Number(e.target.value))}
            aria-label="Максимальна ціна"
            className="range-thumb absolute inset-x-0 w-full appearance-none bg-transparent pointer-events-none"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="rounded border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 min-w-[64px] text-center">
              {minPrice} ₴
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Мін. ціна</span>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <span className="rounded border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 min-w-[64px] text-center">
              {maxPrice} ₴
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Макс. ціна</span>
          </div>
        </div>
      </div>

      {/* Length filter (meters) */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Фільтрувати за довжиною
        </h3>

        <div className="relative h-6 flex items-center">
          <div className="absolute inset-x-0 h-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div
            className="absolute h-0.5 rounded-full bg-zinc-900 dark:bg-zinc-100"
            style={{ left: `${minLenPercent}%`, right: `${100 - maxLenPercent}%` }}
          />
          <input
            type="range"
            min={minLenBound}
            max={maxLenBound}
            step={10}
            value={minLength}
            onChange={(e) => setMinLength(Number(e.target.value))}
            aria-label="Мінімальна довжина"
            className="range-thumb absolute inset-x-0 w-full appearance-none bg-transparent pointer-events-none"
          />
          <input
            type="range"
            min={minLenBound}
            max={maxLenBound}
            step={10}
            value={maxLength}
            onChange={(e) => setMaxLength(Number(e.target.value))}
            aria-label="Максимальна довжина"
            className="range-thumb absolute inset-x-0 w-full appearance-none bg-transparent pointer-events-none"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="rounded border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 min-w-[64px] text-center">
              {minLength} м
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Мін. довжина</span>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <span className="rounded border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 min-w-[64px] text-center">
              {maxLength} м
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Макс. довжина</span>
          </div>
        </div>
      </div>

      {/* Category filter */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Фільтр за категоріями
          </h3>
          {filters.categories.length > 0 && (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {filters.categories.length} вибрано
            </span>
          )}
        </div>

        {/* In-panel category search */}
        <div className="relative">
          <svg
            viewBox="0 0 16 16"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400"
            fill="none"
          >
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            id="category-search"
            type="text"
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
            placeholder="Пошук категорії…"
            aria-label="Пошук категорії"
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-1.5 pl-8 pr-7 text-xs text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600"
          />
          {categoryQuery && (
            <button
              type="button"
              onClick={() => setCategoryQuery("")}
              aria-label="Очистити пошук категорії"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Scrollable list with selected pinned to the top */}
        {visibleCategories.total === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">Нічого не знайдено</p>
        ) : (
          <div className="max-h-72 overflow-y-auto pr-1 -mr-1 [contain:content]">
            {visibleCategories.selected.length > 0 && (
              <ul className="space-y-2.5 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-3">
                {visibleCategories.selected.map((category) => (
                  <CategoryRow
                    key={category}
                    category={category}
                    checked
                    count={categoryCounts[category] ?? 0}
                    onToggle={() => toggleCategory(category)}
                  />
                ))}
              </ul>
            )}
            <ul className="space-y-2.5">
              {visibleCategories.rest.map((category) => (
                <CategoryRow
                  key={category}
                  category={category}
                  checked={false}
                  count={categoryCounts[category] ?? 0}
                  onToggle={() => toggleCategory(category)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Color filter */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Фільтр за кольором
        </h3>
        <ul className="space-y-2.5">
          {colors.map((color) => {
            const checked = filters.colors.includes(color)
            return (
              <li key={color}>
                <button
                  type="button"
                  onClick={() => toggleColor(color)}
                  aria-pressed={checked}
                  className="flex w-full items-center gap-3 group"
                >
                  <span
                    className={`h-5 w-5 rounded-sm border shrink-0 transition-transform ${
                      checked
                        ? "ring-2 ring-offset-2 ring-zinc-900 dark:ring-zinc-100 ring-offset-zinc-50 dark:ring-offset-zinc-950 border-transparent"
                        : "border-zinc-300 dark:border-zinc-700 group-hover:scale-110"
                    }`}
                    style={{ backgroundColor: colorMap[color].hex }}
                  />
                  <span
                    className={`flex-1 text-left text-sm ${
                      checked
                        ? "text-zinc-900 dark:text-zinc-100 font-medium"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {color}
                  </span>
                  <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
                    {colorMap[color].count}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

interface CategoryRowProps {
  category: string
  checked: boolean
  count: number
  onToggle: () => void
}

function CategoryRow({ category, checked, count, onToggle }: CategoryRowProps) {
  const empty = count === 0
  return (
    <li>
      <label className="flex items-center gap-3 cursor-pointer group">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            checked
              ? "border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100"
              : "border-zinc-300 dark:border-zinc-700 group-hover:border-zinc-400"
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
        <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
        <span
          className={`flex-1 text-sm ${
            checked
              ? "font-medium text-zinc-900 dark:text-zinc-100"
              : empty
                ? "text-zinc-400 dark:text-zinc-600"
                : "text-zinc-700 dark:text-zinc-300"
          }`}
        >
          {category}
        </span>
        <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 rounded-full border border-zinc-200 dark:border-zinc-800 px-2 py-0.5">
          {count}
        </span>
      </label>
    </li>
  )
}
