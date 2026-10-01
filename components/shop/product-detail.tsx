"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence } from "motion/react"
import { ArrowLeft, Check, X, Heart, ShoppingBag } from "lucide-react"
import { type Product, clampQuantity, formatPrice, formatQuantity } from "./data"
import { QuantityPicker } from "./quantity-picker"
import { useCart } from "./cart-context"
import { useWishlist } from "./wishlist-context"
import { CartDrawer, usePreloadDialogs } from "./lazy-dialogs"
import { TopBar } from "./top-bar"
import { ProductImage } from "./product-image"

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
  const { addToCart, itemCount } = useCart()
  const { isWishlisted, toggleWishlist } = useWishlist()
  const wished = isWishlisted(product.id)
  usePreloadDialogs()

  // Phones: when the main «Додати в кошик» is off screen, a bar at the bottom keeps it in reach.
  const buyRef = useRef<HTMLButtonElement>(null)
  const [buyVisible, setBuyVisible] = useState(true)
  useEffect(() => {
    const el = buyRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setBuyVisible(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const addAndOpenCart = () => {
    addToCart(product, quantity)
    setIsCartOpen(true)
  }

  return (
    <>
      {/* Same header as the catalog: people often land here straight from Instagram. */}
      <TopBar cartItemCount={itemCount} onCartClick={() => setIsCartOpen(true)} />
      <main id="content" className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className={`mx-auto max-w-5xl px-4 pt-4 md:pt-6 ${inStock ? "pb-28 md:pb-10" : "pb-10"}`}>
          <nav aria-label="Навігація">
            <ol className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-500">
              <li className="shrink-0">
                <Link href="/" className="inline-flex items-center gap-1.5 py-1 hover:text-zinc-900">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Каталог
                </Link>
              </li>
              {product.category && (
                <>
                  <li aria-hidden className="shrink-0 text-zinc-400">
                    ›
                  </li>
                  <li className="min-w-0">
                    <Link
                      href={`/?category=${encodeURIComponent(product.category)}`}
                      className="block truncate py-1 hover:text-zinc-900"
                    >
                      {product.category}
                    </Link>
                  </li>
                </>
              )}
            </ol>
          </nav>

          <div className="mt-4 md:mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            <div>
              <div className="aspect-[4/5] bg-white dark:bg-zinc-900 rounded-xl overflow-hidden">
                <ProductImage
                  src={images[imageIndex]}
                  alt={product.name}
                  width={800}
                  height={1000}
                  sizes="(min-width: 1024px) 480px, (min-width: 768px) 50vw, 100vw"
                  priority
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
                        i === imageIndex
                          ? "border-zinc-900 dark:border-zinc-100"
                          : "border-transparent hover:border-zinc-300"
                      }`}
                    >
                      <ProductImage
                        src={src}
                        alt=""
                        width={56}
                        height={64}
                        sizes="56px"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col">
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 text-balance">
                {product.name}
              </h1>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {formatPrice(product.price)}
                </span>
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
                    ref={buyRef}
                    type="button"
                    onClick={addAndOpenCart}
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
                  <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                    {product.description}
                  </p>
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
                      <ProductImage
                        src={p.image}
                        alt={p.name}
                        width={400}
                        height={500}
                        sizes="(min-width: 768px) 200px, 50vw"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-4 font-medium">{p.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatPrice(p.price)} / {p.priceUnit}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {inStock && (
          <div
            aria-hidden={buyVisible}
            inert={buyVisible || undefined}
            className={`fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur transition-transform duration-200 md:hidden dark:border-zinc-800 dark:bg-zinc-900/95 ${
              buyVisible ? "translate-y-full" : "translate-y-0"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold tabular-nums leading-tight">
                  {formatPrice(product.price * quantity)}
                </p>
                <p className="text-xs text-zinc-500 tabular-nums">{formatQuantity(quantity, product.priceUnit)}</p>
              </div>
              <button
                type="button"
                onClick={addAndOpenCart}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
              >
                <ShoppingBag className="w-4 h-4" aria-hidden />
                Додати в кошик
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>{isCartOpen && <CartDrawer onClose={() => setIsCartOpen(false)} />}</AnimatePresence>
      </main>
    </>
  )
}
