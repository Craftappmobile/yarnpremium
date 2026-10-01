"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { useReturnFocus } from "./use-return-focus"
import { m } from "motion/react"
import { X, Minus, Plus } from "lucide-react"
import Link from "next/link"
import { TAIL_DISCOUNT, formatPrice, formatQuantity, lineTotal, quantityRules, stepQuantity, tailGrams } from "./data"
import { useCart } from "./cart-context"
import { ProductImage } from "./product-image"

interface CartDrawerProps {
  onClose: () => void
}

export function CartDrawer({ onClose }: CartDrawerProps) {
  const { cart, total, removeFromCart, updateQuantity } = useCart()

  const returnFocus = useReturnFocus()

  return (
    // Radix provides the dialog semantics: Escape, focus trap and return, scroll lock.
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal forceMount>
      <Dialog.Overlay asChild forceMount>
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black z-40"
        />
      </Dialog.Overlay>
      <Dialog.Content asChild forceMount aria-describedby={undefined} {...returnFocus}>
      <m.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", ease: "easeOut", duration: 0.25 }}
        className="fixed right-0 top-0 h-dvh w-full sm:w-[400px] bg-white dark:bg-zinc-900 shadow-xl z-50"
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
            <Dialog.Title className="text-lg font-medium">Кошик</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                aria-label="Закрити кошик"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Ваш кошик порожній</p>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-5 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Продовжити покупки
                </button>
              </Dialog.Close>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
              {cart.map((item) => {
                const { min, max } = quantityRules(item)
                const atMax = item.quantity >= max
                return (
                  <div key={item.id} className="flex gap-4 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <ProductImage
                      src={item.image}
                      alt={item.name}
                      width={96}
                      height={96}
                      sizes="96px"
                      className="w-24 h-24 object-cover rounded-md"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-base font-medium leading-snug line-clamp-2">{item.name}</h3>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full shrink-0"
                          aria-label={`Прибрати ${item.name}`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">
                        {formatPrice(item.price)} / {item.priceUnit}
                      </p>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center border border-zinc-200 dark:border-zinc-700 rounded-md">
                          <button
                            onClick={() => updateQuantity(item.id, stepQuantity(item, item.quantity, -1))}
                            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={item.quantity <= min}
                            aria-label="Зменшити кількість"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="px-2 text-sm tabular-nums min-w-[4rem] text-center">
                            {formatQuantity(item.quantity, item.priceUnit)}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.id, stepQuantity(item, item.quantity, 1))}
                            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={atMax}
                            aria-label="Збільшити кількість"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-base font-medium tabular-nums">{formatPrice(lineTotal(item, item.quantity))}</p>
                      </div>

                      <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1.5">
                        {tailGrams(item, item.quantity) > 0
                          ? `Увесь залишок: на ${formatQuantity(tailGrams(item, item.quantity), item.priceUnit)} знижка ${TAIL_DISCOUNT * 100}%`
                          : atMax
                            ? `Максимум на складі: ${formatQuantity(item.stock, item.priceUnit)}`
                            : `${formatQuantity(item.stock, item.priceUnit)} в наявності`}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {cart.length > 0 && (
          <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex justify-between mb-4">
              <span className="text-base">Разом</span>
              <span className="text-base font-medium tabular-nums">{formatPrice(total)}</span>
            </div>
              <Link
                href="/checkout"
                onClick={onClose}
                className="block w-full py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-base font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors text-center"
              >
                Оформити замовлення
              </Link>
          </div>
          )}
        </div>
      </m.div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
