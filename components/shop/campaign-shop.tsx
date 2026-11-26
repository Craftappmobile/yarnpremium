"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence } from "motion/react"
import { ProductGrid } from "./product-grid"
import { CartDrawer, ProductModal, usePreloadDialogs } from "./lazy-dialogs"
import { TopBar } from "./top-bar"
import { Footer } from "./footer"
import { CartBar } from "./cart-bar"
import { TrustStrip } from "./promo-blocks"
import { CampaignBanner, CampaignStrip } from "./campaign-blocks"
import { type Product, promoDeadline } from "./data"
import { announceOffer } from "./assistant"
import { useCart } from "./cart-context"
import { type PackedCatalog, unpackCatalog } from "./catalog-pack"
import type { CampaignSummary } from "./catalog-summary"

/** Cards before «Показати ще», and per click. */
const PAGE_SIZE = 48

type CampaignSort = "stock" | "discount" | "price"

const SORTS: { value: CampaignSort; label: string }[] = [
  { value: "stock", label: "Більше в наявності" },
  { value: "discount", label: "Найбільша знижка" },
  { value: "price", label: "Ціна: від дешевших" },
]

/** Yarn by weight is compared by 100 г, a piece by itself, as their cards show them. */
const shelfPrice = (p: Product) => (p.priceUnit === "г" ? p.price * 100 : p.price)

function sortFor(sort: CampaignSort): (a: Product, b: Product) => number {
  if (sort === "discount") return (a, b) => (b.promo?.percent ?? 0) - (a.promo?.percent ?? 0) || b.stock - a.stock
  if (sort === "price") return (a, b) => shelfPrice(a) - shelfPrice(b)
  // Colours there is plenty of come first: enough of them for a whole garment.
  return (a, b) => b.stock - a.stock
}

/**
 * A sale's page (lib/campaigns.ts): its banner, then everything it covers,
 * filtered by promotion (one per discount file) and sorted by what is in
 * stock. The cart and the product window work as in the catalog.
 */
export default function CampaignShop({ initial, campaign }: { initial: PackedCatalog; campaign: CampaignSummary }) {
  const products = useMemo(() => unpackCatalog(initial), [initial])
  const { itemCount, addToCart, cart } = useCart()
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [group, setGroup] = useState<string | null>(null)
  const [sort, setSort] = useState<CampaignSort>("stock")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  usePreloadDialogs()

  const offer = `${campaign.name} ${campaign.mixed ? "до " : ""}−${campaign.percent}% на ${campaign.groups.map((g) => `«${g.title}»`).join(", ")} — ${promoDeadline({ name: campaign.name, percent: campaign.percent, endsAt: campaign.endsAt })}`
  useEffect(() => {
    announceOffer(offer)
    return () => announceOffer(null)
  }, [offer])

  const shown = products.filter((p) => group === null || (p.promo?.title ?? p.category) === group).sort(sortFor(sort))
  const remaining = shown.length - visibleCount

  const pick = (title: string | null) => {
    setGroup(title)
    setVisibleCount(PAGE_SIZE)
  }
  const showProducts = () => document.getElementById("content")?.scrollIntoView({ behavior: "smooth", block: "start" })

  const chip = (active: boolean) =>
    `min-h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm transition-colors ${
      active
        ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-white dark:bg-white dark:text-zinc-900"
        : "border-zinc-300 bg-white font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    }`

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <TopBar cartItemCount={itemCount} onCartClick={() => setIsCartOpen(true)} />
      <CampaignStrip campaign={campaign} />

      <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-3 lg:pt-8">
        <CampaignBanner campaign={campaign} onShow={showProducts} heading="h1" />

        <div id="content" className="scroll-mt-20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Що в акції"
              className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0"
            >
              <button type="button" aria-pressed={group === null} onClick={() => pick(null)} className={chip(group === null)}>
                Усе зі знижкою · {campaign.count}
              </button>
              {campaign.groups.map((g) => (
                <button
                  key={g.title}
                  type="button"
                  aria-pressed={group === g.title}
                  onClick={() => pick(g.title)}
                  className={chip(group === g.title)}
                >
                  {g.title} {g.mixed ? "до " : ""}−{g.percent}% · {g.count}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <span className="hidden sm:inline">Сортувати</span>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as CampaignSort)
                  setVisibleCount(PAGE_SIZE)
                }}
                aria-label="Сортувати"
                className="min-h-10 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mb-1 mt-3">
            <TrustStrip compact />
          </div>
          <h2 className="sr-only">Товари зі знижкою</h2>
          <ProductGrid products={shown.slice(0, visibleCount)} onProductSelect={setSelectedProduct} />
          {remaining > 0 && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="min-h-11 rounded-lg border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Показати ще {remaining}
              </button>
            </div>
          )}
        </div>
      </div>

      <Footer />
      {cart.length > 0 && <div aria-hidden className="h-20" />}
      <CartBar onOpenCart={() => setIsCartOpen(true)} />

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onAddToCart={(product, quantity) => {
              addToCart(product, quantity)
              setSelectedProduct(null)
              setIsCartOpen(true)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{isCartOpen && <CartDrawer onClose={() => setIsCartOpen(false)} />}</AnimatePresence>
    </div>
  )
}
