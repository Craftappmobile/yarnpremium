"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { useReturnFocus } from "./use-return-focus"
import { motion } from "motion/react"
import { X, Check, Heart, ShoppingBag, ExternalLink } from "lucide-react"
import { useState } from "react"
import Link from "next/link"
import { type Product, clampQuantity, formatPrice, formatQuantity } from "./data"
import { QuantityPicker } from "./quantity-picker"
import { useWishlist } from "./wishlist-context"

interface ProductModalProps {
  product: Product
  onClose: () => void
  onAddToCart: (product: Product, quantity: number) => void
}

export function ProductModal({ product, onClose, onAddToCart }: ProductModalProps) {
  const inStock = product.stock > 0
  const [quantity, setQuantity] = useState(() => clampQuantity(product, product.minQty))
  const { isWishlisted, toggleWishlist } = useWishlist()
  const wished = isWishlisted(product.id)


  const returnFocus = useReturnFocus()

  return (
    // Radix provides the dialog semantics: Escape, focus trap and return, scroll lock.
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal forceMount>
      <Dialog.Overlay asChild forceMount>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black z-40"
        />
      </Dialog.Overlay>
      <Dialog.Content asChild forceMount aria-describedby={undefined} {...returnFocus}>
      <motion.div
        layoutId={`product-${product.id}`}
        className="fixed inset-x-4 bottom-0 md:inset-0 md:m-auto md:h-fit md:max-w-3xl z-50 bg-white dark:bg-zinc-900 rounded-t-2xl md:rounded-2xl overflow-hidden max-h-[88dvh] md:max-h-[560px]"
      >
        <div className="h-full flex flex-col md:flex-row max-h-[88dvh] md:max-h-[560px]">
          <div className="relative md:w-2/5 shrink-0">
            <img
              src={product.image || "/placeholder.svg"}
              alt={product.name}
              className="w-full h-[200px] md:h-full object-cover"
            />
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Закрити"
                className="absolute top-3 right-3 p-2.5 bg-white/80 dark:bg-black/50 backdrop-blur-sm rounded-full hover:bg-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 md:p-6 flex flex-col">
            <Dialog.Title className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 text-balance">{product.name}</Dialog.Title>

            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{formatPrice(product.price)}</span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">/ {product.priceUnit}</span>
            </div>

            {/* Наявність — приходить із KeyCRM (offer.quantity) */}
            <div className="mt-3">
              {inStock ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-500">
                  <Check className="w-4 h-4" />
                  {formatQuantity(product.stock, product.priceUnit)} в наявності
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600 dark:text-rose-500">
                  <X className="w-4 h-4" />
                  Немає в наявності
                </span>
              )}
            </div>

            {inStock && (
              <div className="mt-4 space-y-3">
                <QuantityPicker product={product} quantity={quantity} onChange={setQuantity} />

                <button
                  type="button"
                  onClick={() => onAddToCart(product, quantity)}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                >
                  <ShoppingBag className="w-4 h-4" />
                  Додати в кошик
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => toggleWishlist(product)}
              className="mt-1 py-2 inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors self-start"
            >
              <Heart className={`w-4 h-4 ${wished ? "fill-rose-500 text-rose-500" : ""}`} />
              {wished ? "У списку бажань" : "Додати до списку бажань"}
            </button>

            <Link
              href={`/product/${product.sku}`}
              className="py-2 inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors self-start"
            >
              <ExternalLink className="w-4 h-4" />
              Відкрити сторінку товару
            </Link>

            <div className="mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2 text-sm">
              {product.description && (
                <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">{product.description}</p>
              )}
              <p className="text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-500">Артикул:</span> {product.sku}
              </p>
              <p className="text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-500">Категорія:</span> {product.category}
              </p>
              {product.brand && (
                <p className="text-zinc-700 dark:text-zinc-300">
                  <span className="text-zinc-500 dark:text-zinc-500">Виробник:</span> {product.brand}
                  {product.article && ` · ${product.article}`}
                </p>
              )}
              {product.color && (
                <p className="text-zinc-700 dark:text-zinc-300">
                  <span className="text-zinc-500 dark:text-zinc-500">Колір:</span> {product.color}
                </p>
              )}
              {product.length > 0 && (
                <p className="text-zinc-700 dark:text-zinc-300">
                  <span className="text-zinc-500 dark:text-zinc-500">Метраж:</span> {product.length} м
                </p>
              )}
            </div>
          </div>
        </div>
      </motion.div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
