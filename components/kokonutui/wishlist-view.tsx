"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence } from "motion/react"
import { ArrowLeft, Heart, X, ShoppingBag } from "lucide-react"
import { formatPrice } from "./data"
import { useWishlist } from "./wishlist-context"
import { useCart } from "./cart-context"
import { CartDrawer } from "./cart-drawer"

export function WishlistView() {
  const { wishlist, removeFromWishlist } = useWishlist()
  const { addToCart } = useCart()
  const [isCartOpen, setIsCartOpen] = useState(false)

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          До магазину
        </Link>

        <h1 className="mt-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Список бажань</h1>

        {wishlist.length === 0 ? (
          <div className="mt-16 flex flex-col items-center justify-center text-center">
            <Heart className="w-10 h-10 text-zinc-300 dark:text-zinc-700" />
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Ваш список бажань порожній</p>
            <Link
              href="/"
              className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100 underline underline-offset-4"
            >
              Перейти до товарів
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {wishlist.map((product) => {
              const inStock = product.stock > 0
              return (
                <div
                  key={product.id}
                  className="flex gap-4 p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <img
                    src={product.image || "/placeholder.svg"}
                    alt={product.name}
                    className="w-24 h-24 object-cover rounded-md shrink-0"
                  />
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-50 truncate">
                          {product.name}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {formatPrice(product.price)} / {product.priceUnit}
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                          {inStock ? `${product.stock} в наявності` : "Немає в наявності"}
                        </p>
                      </div>
                      <button
                        onClick={() => removeFromWishlist(product.id)}
                        className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full shrink-0"
                        aria-label={`Прибрати ${product.name}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-auto pt-2">
                      <button
                        type="button"
                        disabled={!inStock}
                        onClick={() => {
                          addToCart(product, 1)
                          setIsCartOpen(true)
                        }}
                        className="inline-flex items-center gap-2 py-2 px-4 text-sm font-medium rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 disabled:cursor-not-allowed"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        {inStock ? "Додати в кошик" : "Немає в наявності"}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AnimatePresence>{isCartOpen && <CartDrawer onClose={() => setIsCartOpen(false)} />}</AnimatePresence>
    </main>
  )
}
