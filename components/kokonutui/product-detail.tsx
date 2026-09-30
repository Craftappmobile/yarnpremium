"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, X, Heart, Minus, Plus, ShoppingBag } from "lucide-react"
import { type Product, formatPrice } from "./data"
import { useCart } from "./cart-context"
import { useWishlist } from "./wishlist-context"

export function ProductDetail({ product }: { product: Product }) {
  const router = useRouter()
  const inStock = product.stock > 0
  const [quantity, setQuantity] = useState(1)
  const { addToCart } = useCart()
  const { isWishlisted, toggleWishlist } = useWishlist()
  const wished = isWishlisted(product.id)

  const clamp = (n: number) => Math.max(1, Math.min(n, product.stock))

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          До магазину
        </Link>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="aspect-[4/5] bg-white dark:bg-zinc-900 rounded-xl overflow-hidden">
            <img
              src={product.image || "/placeholder.svg"}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-widest text-zinc-400 dark:text-zinc-500">{product.category}</p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50 text-balance">
              {product.name}
            </h1>

            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{formatPrice(product.price)}</span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">/ {product.priceUnit}</span>
            </div>

            <div className="mt-3">
              {inStock ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-500">
                  <Check className="w-4 h-4" />
                  {product.stock} в наявності
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600 dark:text-rose-500">
                  <X className="w-4 h-4" />
                  Немає в наявності
                </span>
              )}
            </div>

            {inStock && (
              <div className="mt-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => clamp(q - 1))}
                      disabled={quantity <= 1}
                      aria-label="Зменшити кількість"
                      className="p-2.5 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center text-sm font-medium tabular-nums">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => clamp(q + 1))}
                      disabled={quantity >= product.stock}
                      aria-label="Збільшити кількість"
                      className="p-2.5 text-zinc-600 dark:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuantity(product.stock)}
                    className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Візьміть усе ({product.stock})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    addToCart(product, quantity)
                    router.push("/checkout")
                  }}
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
              className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors self-start"
            >
              <Heart className={`w-4 h-4 ${wished ? "fill-rose-500 text-rose-500" : ""}`} />
              {wished ? "У списку бажань" : "Додати до списку бажань"}
            </button>

            <div className="mt-6 pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-2 text-sm">
              <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">{product.description}</p>
              <p className="text-zinc-500 dark:text-zinc-400">
                <span className="text-zinc-400 dark:text-zinc-500">Артикул:</span> {product.sku}
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                <span className="text-zinc-400 dark:text-zinc-500">Колір:</span> {product.color}
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                <span className="text-zinc-400 dark:text-zinc-500">Метраж:</span> {product.length} м
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
