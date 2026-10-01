"use client"

import { Minus, Plus } from "lucide-react"
import { type Product, TAIL_DISCOUNT, formatQuantity, quantityRules, stepQuantity, tailGrams } from "./data"

interface QuantityPickerProps {
  product: Pick<Product, "stock" | "minQty" | "step" | "priceUnit">
  quantity: number
  onChange: (quantity: number) => void
}

/**
 * +/− picker that follows the product's limits: yarn by weight starts at its
 * minimum (100 g, cashmere 50 g) and moves in 50 g steps; "Взяти все" takes the
 * whole spool. A purchase can't leave less than the minimum behind: past the
 * last such step it takes the whole spool, with the end of it 10% off.
 */
export function QuantityPicker({ product, quantity, onChange }: QuantityPickerProps) {
  const { min, max } = quantityRules(product)
  const tail = tailGrams(product, quantity)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => onChange(stepQuantity(product, quantity, -1))}
            disabled={quantity <= min}
            aria-label="Зменшити кількість"
            className="p-2.5 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="min-w-16 px-1 text-center text-sm font-medium tabular-nums">
            {formatQuantity(quantity, product.priceUnit)}
          </span>
          <button
            type="button"
            onClick={() => onChange(stepQuantity(product, quantity, 1))}
            disabled={quantity >= max}
            aria-label="Збільшити кількість"
            className="p-2.5 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onChange(max)}
          disabled={quantity === max}
          className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60 transition-colors"
        >
          Взяти все ({formatQuantity(max, product.priceUnit)})
        </button>
      </div>
      {tail > 0 && (
        <p className="text-sm text-emerald-700" aria-live="polite">
          Після {formatQuantity(quantity - tail, product.priceUnit)} на бобіні лишилося б{" "}
          {formatQuantity(tail, product.priceUnit)} — окремо ми їх не продаємо, тому вони додаються до покупки зі
          знижкою {TAIL_DISCOUNT * 100}%.
        </p>
      )}
    </div>
  )
}
