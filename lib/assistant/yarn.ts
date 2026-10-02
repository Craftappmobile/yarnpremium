// How much of a yarn to buy for a pattern. Plain arithmetic, kept out of the
// model so the numbers a buyer sees are always the same for the same question.

import { type Product, isValidQuantity, lineTotal } from "@/components/shop/data"

export interface YarnNeed {
  /** Total length the pattern needs, in metres of one strand of the pattern yarn. */
  patternMeters: number
  /** Strands of this yarn held together in place of one strand of the pattern yarn. */
  strands: number
  /** Extra on top, in percent (knitters usually keep 10% in reserve). */
  reservePercent: number
}

export type YarnPlan =
  | { ok: false; reason: string }
  | {
      ok: true
      /** Length of one strand of this yarn per 100 g, divided by the strands: comparable with the pattern yarn's. */
      effectiveMetersPer100g: number
      gramsNeeded: number
      /** Valid quantity to buy (minimum, steps, whole spool), capped at the stock. */
      gramsToBuy: number
      price: number
      enoughInStock: boolean
      /** Grams missing when the stock is too small; 0 otherwise. */
      shortfall: number
      wholeSpool: boolean
    }

/**
 * Takes `product.length` (KeyCRM field «Метраж») of yarn sold by weight as
 * metres per 100 g, the usual way bobbin yarn is labelled.
 */
export function planYarn(product: Product, need: YarnNeed): YarnPlan {
  if (product.priceUnit !== "г") return { ok: false, reason: "Розрахунок можливий лише для пряжі на вагу." }
  if (!(product.length > 0)) return { ok: false, reason: "Для цієї пряжі не вказано метраж." }
  if (product.stock <= 0) return { ok: false, reason: "Цієї пряжі зараз немає в наявності." }

  const metersOfThisYarn = need.patternMeters * need.strands
  const gramsNeeded = Math.ceil(((metersOfThisYarn / product.length) * 100 * (100 + need.reservePercent)) / 100)

  // Round up to the next amount that can be bought: the minimum, then whole steps.
  const steps = Math.max(0, Math.ceil((gramsNeeded - product.minQty) / product.step))
  let gramsToBuy = product.minQty + steps * product.step
  let enoughInStock = gramsToBuy <= product.stock
  if (!enoughInStock) {
    // Less than a whole step short of the stock still fits in the spool.
    enoughInStock = gramsNeeded <= product.stock
    gramsToBuy = product.stock
  } else if (!isValidQuantity(product, gramsToBuy)) {
    // Would leave less than the minimum behind: only the whole spool can be taken.
    gramsToBuy = product.stock
  }

  return {
    ok: true,
    effectiveMetersPer100g: Math.round(product.length / need.strands),
    gramsNeeded,
    gramsToBuy,
    price: lineTotal(product, gramsToBuy),
    enoughInStock,
    shortfall: enoughInStock ? 0 : gramsNeeded - product.stock,
    wholeSpool: gramsToBuy === product.stock,
  }
}
