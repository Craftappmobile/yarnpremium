"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence } from "motion/react"
import { ArrowLeft, Check, X, Heart, ShoppingBag } from "lucide-react"
import { type Product, clampQuantity, formatPrice, formatQuantity } from "./data"
import { QuantityPicker } from "./quantity-picker"
import { useCart } from "./cart-context"
import { useWishlist } from "./wishlist-context"
import { CartDrawer } from "./cart-drawer"

interface ProductDetailProps {
  product: Product
  /** In-stock products from the same category, shown when this one is sold out. */
  similar?: Product[]
}

export function ProductDetail({ product, similar = [] }: ProductDetailProps) {
  const inStock = product.stock > 0
  const images = product.images.length > 0 ? product.images : [product.image]
  const [imageIndex, setImageIndex] = useState(0)
  const [quantity, setQuantity] = useState(() => clampQuantity(product, product.minQty))
  const [isCartOpen, setIsCartOpen] = useState(false)
  const { addToCart } = useCart()
  const { isWishlisted, toggleWishlist } = useWishlist()
  const wished = isWishlisted(product.id)

  return (
    <main id="content" className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          До магазину
        </Link>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="aspect-[4/5] bg-white dark:bg-zinc-900 rounded-xl overflow-hidden">
              <img
                src={images[imageIndex] || "/placeholder.svg"}
                alt={product.name}
                width={800}
                height={1000}
                fetchPriority="high"
                className="w-full h-full object-cover"
              />
            </div>
            {images.length > 1 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {images.map((src, i) => (
                  <button
                    type="button"
                    key={src}
                    onClick={() => setImageIndex(i)}
                    aria-label={`Фото ${i + 1}`}
                    aria-current={i === imageIndex}
                    className={`h-16 w-14 shrink-0 overflow-hidden rounded-md border-2 ${
                      i === imageIndex ? "border-zinc-900 dark:border-zinc-100" : "border-transparent hover:border-zinc-300"
                    }`}
                  >
                    <img src={src} alt="" width={56} height={64} loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-500">{product.category}</p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50 text-balance">
              {product.name}
            </h1>

            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{formatPrice(product.price)}</span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">/ {product.priceUnit}</span>
            </div>

            <div className="mt-3">
              {inStock ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-500">
                  <Check className="w-4 h-4" />
                  {formatQuantity(product.stock, product.priceUnit)} в наявності
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600 dark:text-rose-500">
                  <X className="w-4 h-4" />
                  Цю пряжу розпродано
                </span>
              )}
            </div>

            {inStock && (
              <div className="mt-5 space-y-3">
                <QuantityPicker product={product} quantity={quantity} onChange={setQuantity} />

                <button
                  type="button"
                  onClick={() => {
                    addToCart(product, quantity)
                    setIsCartOpen(true)
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
              className="mt-1 py-2 inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors self-start"
            >
              <Heart className={`w-4 h-4 ${wished ? "fill-rose-500 text-rose-500" : ""}`} />
              {wished ? "У списку бажань" : "Додати до списку бажань"}
            </button>

            <div className="mt-6 pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-2 text-sm">
              {product.description && (
                <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">{product.description}</p>
              )}
              <p className="text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-500">Артикул:</span> {product.sku}
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
        {!inStock && similar.length > 0 && (
          <section className="mt-12">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-balance text-zinc-700 dark:text-zinc-300">
              Схожа пряжа в наявності
            </h2>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {similar.map((p) => (
                <Link key={p.sku} href={`/product/${p.sku}`} className="group">
                  <div className="aspect-[4/5] overflow-hidden rounded-md bg-white dark:bg-zinc-900">
                    <img
                      src={p.image || "/placeholder.svg"}
                      alt={p.name}
                      width={400}
                      height={500}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <p className="mt-1.5 truncate text-xs font-medium">{p.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatPrice(p.price)} / {p.priceUnit}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <AnimatePresence>{isCartOpen && <CartDrawer onClose={() => setIsCartOpen(false)} />}</AnimatePresence>
    </main>
  )
}
