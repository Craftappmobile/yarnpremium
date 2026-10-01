"use client"

import { Heart } from "lucide-react"
import { type Product, formatPrice } from "./data"
import { useWishlist } from "./wishlist-context"
import { ProductImage } from "./product-image"

interface ProductGridProps {
  products: Product[]
  onProductSelect: (product: Product) => void
}

export function ProductGrid({ products, onProductSelect }: ProductGridProps) {
  const { isWishlisted, toggleWishlist } = useWishlist()

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-x-2 gap-y-4">
      {products.map((product, i) => {
        const wished = isWishlisted(product.id)
        return (
          <div
            key={product.id}
            className="group relative transition-transform duration-200 hover:-translate-y-px motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <button
              type="button"
              onClick={() => onProductSelect(product)}
              className="block w-full text-left rounded-md"
            >
              <div className="relative aspect-[4/5] bg-white dark:bg-zinc-900 rounded-md overflow-hidden">
                <ProductImage
                  src={product.image}
                  alt={product.name}
                  width={400}
                  height={500}
                  sizes="(min-width: 1280px) 200px, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                  loading={i < 6 ? "eager" : "lazy"}
                  fetchPriority={i < 2 ? "high" : undefined}
                  className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
                {product.stock === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/60">
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
                      Немає в наявності
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-1.5 space-y-0.5">
                <h3 className="text-sm leading-5 font-medium line-clamp-2 min-h-10">{product.name}</h3>
                <div className="flex justify-between items-baseline gap-2">
                  <p className="shrink-0 text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatPrice(product.price)}
                    {product.priceUnit === "г" && <span className="text-zinc-500"> / г</span>}
                  </p>
                  {/* The colour tells skeins of one yarn apart; long names can hide it. */}
                  <p className="min-w-0 text-right text-xs text-zinc-500 dark:text-zinc-500 truncate">
                    {product.color || product.category}
                  </p>
                </div>
              </div>
            </button>
            {/* A sibling of the card button, not inside it: buttons can't nest. */}
            <button
              type="button"
              onClick={() => toggleWishlist(product)}
              aria-label={wished ? "Прибрати зі списку бажань" : "Додати до списку бажань"}
              aria-pressed={wished}
              className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-white/80 dark:bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[wished=true]:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
              data-wished={wished}
            >
              <Heart className={`w-3.5 h-3.5 ${wished ? "fill-rose-500 text-rose-500" : "text-zinc-700"}`} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
