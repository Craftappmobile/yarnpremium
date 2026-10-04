"use client"

import Link from "next/link"
import { MessageCircle, ShoppingBag } from "lucide-react"
import { formatPrice } from "./data"
import { useCart } from "./cart-context"
import { ASSISTANT_ENABLED, openAssistant } from "./assistant"

/**
 * Bottom bar of the catalog while the cart has something: what it comes to,
 * what promotions and offers save, and the way to checkout without leaving
 * the colours. The consultant's button moves into it (the floating one hides).
 */
export function CartBar({ onOpenCart }: { onOpenCart: () => void }) {
  const { cart, total, saved, hydrated } = useCart()
  if (!hydrated || cart.length === 0) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <div className="mx-auto flex max-w-[1400px] items-center gap-2">
        <button type="button" onClick={onOpenCart} className="min-w-0 flex-1 text-left">
          <span className="block text-base font-bold leading-tight tabular-nums">{formatPrice(total)}</span>
          <span className="block text-xs tabular-nums text-zinc-500">
            {saved > 0 ? (
              <span className="text-emerald-700 dark:text-emerald-500">Економія {formatPrice(saved)}</span>
            ) : (
              "Переглянути кошик"
            )}
          </span>
        </button>
        {ASSISTANT_ENABLED && (
          <button
            type="button"
            onClick={() => openAssistant(undefined, "cart_bar")}
            aria-label="Запитати консультанта"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
          >
            <MessageCircle className="h-5 w-5" aria-hidden />
          </button>
        )}
        <Link
          href="/checkout"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
        >
          <ShoppingBag className="h-4 w-4" aria-hidden />
          Оформити
        </Link>
      </div>
    </div>
  )
}
