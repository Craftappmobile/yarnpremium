"use client"

import { useState } from "react"
import { Minus, Plus } from "lucide-react"
import {
  type Product,
  TAIL_DISCOUNT,
  clampQuantity,
  formatPrice,
  formatQuantity,
  leftoverOffer,
  lineTotal,
  quantityRules,
  stepQuantity,
} from "./data"

type PickerProduct = Pick<Product, "stock" | "minQty" | "step" | "priceUnit" | "price">

/**
 * The amount picked on a product: `tail` grams of `quantity` are an accepted
 * leftover offer. `pending` while an offer waits for an answer: the amount
 * can't go into the cart until the buyer takes the leftover or picks another.
 */
export function useQuantityChoice(product: PickerProduct) {
  const [choice, setChoice] = useState(() => ({ quantity: clampQuantity(product, product.minQty), tail: 0 }))
  const offer = choice.tail === 0 ? leftoverOffer(product, choice.quantity) : 0
  return {
    ...choice,
    offer,
    pending: offer > 0,
    total: lineTotal(product, choice.quantity, choice.tail),
    set: (quantity: number, tail = 0) => setChoice({ quantity, tail }),
  }
}

interface QuantityPickerProps {
  product: PickerProduct
  quantity: number
  tail: number
  onChange: (quantity: number, tail: number) => void
  /** Id of the offer card, for the add button's aria-describedby. */
  offerId?: string
}

/**
 * +/− picker that follows the product's limits: yarn by weight starts at its
 * minimum (100 g, cashmere 50 g) and moves in 50 g steps; "Взяти все" takes the
 * whole spool. An amount that would leave less than the minimum on the spool
 * comes with an offer to take that leftover too, 10% off; without it the
 * amount can't be bought.
 */
export function QuantityPicker({ product, quantity, tail, onChange, offerId }: QuantityPickerProps) {
  const { min, max } = quantityRules(product)
  const offer = tail === 0 ? leftoverOffer(product, quantity) : 0
  const unit = product.priceUnit
  // The +/− work on the amount picked; an accepted leftover rides along until it changes.
  const base = quantity - tail

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => onChange(stepQuantity(product, base, -1), 0)}
            disabled={base <= min}
            aria-label="Зменшити кількість"
            className="p-2.5 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="min-w-16 px-1 text-center text-sm font-medium tabular-nums">
            {formatQuantity(base, unit)}
          </span>
          <button
            type="button"
            onClick={() => onChange(stepQuantity(product, base, 1), 0)}
            disabled={base >= max}
            aria-label="Збільшити кількість"
            className="p-2.5 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onChange(max, 0)}
          disabled={quantity === max}
          className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60 transition-colors"
        >
          Взяти все ({formatQuantity(max, unit)})
        </button>
      </div>

      <div aria-live="polite">
        {offer > 0 && (
          <div id={offerId} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-zinc-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-zinc-100">
            <p>
              Після покупки залишиться {formatQuantity(offer, unit)} — окремо ми їх не продаємо. Заберіть і цей залишок
              зі знижкою {TAIL_DISCOUNT * 100}%:{" "}
              <span className="whitespace-nowrap font-medium tabular-nums">
                {formatPrice(lineTotal(product, offer, offer))}
              </span>{" "}
              <span className="whitespace-nowrap text-zinc-500 line-through tabular-nums dark:text-zinc-400">
                {formatPrice(lineTotal(product, offer))}
              </span>
              .
            </p>
            <button
              type="button"
              onClick={() => onChange(quantity + offer, offer)}
              className="mt-2 w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 transition-colors"
            >
              Додати {formatQuantity(offer, unit)} зі знижкою
            </button>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              Або виберіть іншу кількість: {formatQuantity(quantity, unit)} без залишку купити не можна.
            </p>
          </div>
        )}
        {tail > 0 && (
          <p className="text-sm text-emerald-700 dark:text-emerald-500">
            + залишок {formatQuantity(tail, unit)} зі знижкою {TAIL_DISCOUNT * 100}%, разом{" "}
            {formatQuantity(quantity, unit)}.{" "}
            <button
              type="button"
              onClick={() => onChange(base, 0)}
              className="font-medium text-zinc-600 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-300"
            >
              Прибрати
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
