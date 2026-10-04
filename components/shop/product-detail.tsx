"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence } from "motion/react"
import { ArrowLeft, Check, X, Heart, MessageCircle, Play, ShoppingBag } from "lucide-react"
import type { ProductVideos } from "@/lib/product-videos"
import {
  type Product,
  clampQuantity,
  formatPrice,
  formatPriceShort,
  formatQuantity,
  lineSavings,
  lineTotal,
  promoLastDay,
} from "./data"
import { ASSISTANT_ENABLED, openAssistant } from "./assistant"
import { QuantityPicker } from "./quantity-picker"
import { trackViewItem } from "./analytics"
import { useCart } from "./cart-context"
import { useWishlist } from "./wishlist-context"
import { CartDrawer, usePreloadDialogs } from "./lazy-dialogs"
import { TopBar } from "./top-bar"
import { ProductImage } from "./product-image"
import { ProductMedia, useProductMedia } from "./product-media"
import { OldPrice, PromoBadge } from "./promo-price"

interface ProductDetailProps {
  product: Product
  /** Video review and sample video from Google Drive (lib/product-videos.ts), if the product has any. */
  videos?: ProductVideos | null
  /** In-stock products of the nearest shades (lib/similar-products.ts), shown when this one is sold out. */
  similar?: Product[]
  /** `similar` was picked by colour, not by category alone. */
  similarByColor?: boolean
}

/** Yarn by weight is priced per gram; the card shows the price of 100 g, which people compare. */
const PRICE_GRAMS = 100
/** KeyCRM fields about the yarn itself; the rest of `specs` describe the shop's knitted sample. */
const YARN_SPECS = ["Склад"]

export function ProductDetail({ product, videos = null, similar = [], similarByColor = false }: ProductDetailProps) {
  const inStock = product.stock > 0
  const byWeight = product.priceUnit === "г"
  const yarnSpecs = (product.specs ?? []).filter((s) => YARN_SPECS.includes(s.name))
  const sampleSpecs = (product.specs ?? []).filter((s) => !YARN_SPECS.includes(s.name))
  const askAssistant = () => openAssistant({ sku: product.sku, name: product.name })
  const images = product.images.length > 0 ? product.images : [product.image]
  const media = useProductMedia(images, videos)
  const sample = media.slides.find((s) => s.key === "sample" && s.kind === "video")
  const mediaRef = useRef<HTMLDivElement>(null)
  const [quantity, setQuantity] = useState(() => clampQuantity(product, product.minQty))
  const saved = lineSavings(product, quantity)
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

  useEffect(() => {
    if (inStock) trackViewItem(product)
    // Once per product page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.sku])

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
            <div ref={mediaRef} className="scroll-mt-20">
              <ProductMedia name={product.name} sku={product.sku} media={media} />
            </div>

            <div className="flex flex-col">
              {(product.brand || byWeight) && (
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {[product.brand, byWeight && "Стокова партія"].filter(Boolean).join(" · ")}
                </p>
              )}
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 text-balance">
                {product.name}
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {[product.sku, product.length > 0 && `${product.length} м${byWeight ? ` / ${PRICE_GRAMS} г` : ""}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <PromoBadge product={product} className="self-center text-sm" />
                <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {byWeight ? formatPriceShort(product.price * PRICE_GRAMS) : formatPrice(product.price)}
                </span>
                {product.oldPrice ? (
                  <OldPrice className="text-base">
                    {byWeight ? formatPriceShort(product.oldPrice * PRICE_GRAMS) : formatPrice(product.oldPrice)}
                  </OldPrice>
                ) : null}
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  / {byWeight ? `${PRICE_GRAMS} г` : product.priceUnit}
                </span>
                {byWeight && (
                  <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatPriceShort(product.price)} за 1 г
                  </span>
                )}
              </div>
              {product.promo && (
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {product.promo.name} · до {promoLastDay(product.promo)} включно
                </p>
              )}

              <div className="mt-3">
                {inStock ? (
                  <span className="inline-flex items-start gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-500">
                    <Check className="mt-0.5 w-4 h-4 shrink-0" />
                    <span>
                      {formatQuantity(product.stock, product.priceUnit)} в наявності
                      {byWeight && <span className="font-normal">. Партія не повторюється</span>}
                    </span>
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
                  {saved > 0 && (
                    <p className="text-sm tabular-nums text-emerald-700 dark:text-emerald-500" aria-live="polite">
                      {formatQuantity(quantity, product.priceUnit)} за {formatPriceShort(lineTotal(product, quantity))}{" "}
                      замість {formatPriceShort(lineTotal(product, quantity) + saved)} · економія {formatPriceShort(saved)}
                    </p>
                  )}
                  {byWeight && ASSISTANT_ENABLED && (
                    <button
                      type="button"
                      onClick={askAssistant}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900 dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:text-zinc-50"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      Скільки мені треба? Порахує консультант
                    </button>
                  )}

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

              {!inStock && ASSISTANT_ENABLED && (
                <button
                  type="button"
                  onClick={askAssistant}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  Підібрати схожу пряжу з консультантом
                </button>
              )}

              <button
                type="button"
                onClick={() => toggleWishlist(product)}
                className="mt-1 py-2 inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors self-start"
              >
                <Heart className={`w-4 h-4 ${wished ? "fill-rose-500 text-rose-500" : ""}`} />
                {wished ? "У списку бажань" : "Додати до списку бажань"}
              </button>

              {sample?.kind === "video" && (
                <div className="mt-5 flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Зразок із відео</p>
                    <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                      {sample.video.caption || "Як ця пряжа виглядає у в'язанні"}
                    </p>
                    {sampleSpecs.length > 0 && (
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                        {sampleSpecs.map((s) => (
                          <div key={s.name} className="contents">
                            <dt className="text-zinc-500 dark:text-zinc-400">{s.name}</dt>
                            <dd className="text-zinc-900 dark:text-zinc-100">{s.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      media.show("sample")
                      // Phones: the gallery is above, out of sight by now.
                      const el = mediaRef.current
                      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth" })
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                    Дивитись
                  </button>
                </div>
              )}

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
                    {byWeight && ` / ${PRICE_GRAMS} г`}
                  </p>
                )}
                {/* Sample details go to the sample video's card when there is one. */}
                {[...yarnSpecs, ...(sample ? [] : sampleSpecs)].map((s) => (
                  <p key={s.name} className="text-zinc-700 dark:text-zinc-300">
                    <span className="text-zinc-500 dark:text-zinc-500">
                      {YARN_SPECS.includes(s.name) ? s.name : `${s.name} (зразок)`}:
                    </span>{" "}
                    {s.value}
                  </p>
                ))}
              </div>

            </div>
          </div>
          {!inStock && similar.length > 0 && (
            <section className="mt-12">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-balance text-zinc-700 dark:text-zinc-300">
                {similarByColor ? "Схожі відтінки в наявності" : "Схожа пряжа в наявності"}
              </h2>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {similar.map((p) => (
                  <Link key={p.sku} href={`/product/${p.sku}`} className="group">
                    <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-white dark:bg-zinc-900">
                      <ProductImage
                        src={p.image}
                        alt={p.name}
                        width={400}
                        height={500}
                        sizes="(min-width: 768px) 200px, 50vw"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <PromoBadge product={p} className="absolute left-1.5 top-1.5" />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-4 font-medium">{p.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      <span className={p.oldPrice ? "font-semibold text-zinc-900 dark:text-zinc-50" : undefined}>
                        {formatPrice(p.price)}
                      </span>
                      {p.oldPrice ? <OldPrice className="ml-1">{formatPrice(p.oldPrice)}</OldPrice> : null} / {p.priceUnit}
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
                  {formatPriceShort(lineTotal(product, quantity))}
                </p>
                <p className="text-xs text-zinc-500 tabular-nums">
                  {formatQuantity(quantity, product.priceUnit)}
                  {saved > 0 && <span className="text-emerald-700"> · економія {formatPriceShort(saved)}</span>}
                </p>
              </div>
              {ASSISTANT_ENABLED && (
                <button
                  type="button"
                  onClick={askAssistant}
                  aria-label="Запитати консультанта"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden />
                </button>
              )}
              <button
                type="button"
                onClick={addAndOpenCart}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
              >
                <ShoppingBag className="w-4 h-4" aria-hidden />
                В кошик
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>{isCartOpen && <CartDrawer onClose={() => setIsCartOpen(false)} />}</AnimatePresence>
      </main>
    </>
  )
}
