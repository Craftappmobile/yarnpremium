import type { Product } from "./data"

/** "−25%" over a product photo while a promotion covers the product. */
export function PromoBadge({ product, className = "" }: { product: Pick<Product, "promo">; className?: string }) {
  if (!product.promo) return null
  return (
    <span
      className={`rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white dark:bg-white dark:text-zinc-900 ${className}`}
    >
      −{product.promo.percent}%
    </span>
  )
}

/** The regular price, struck through; screen readers hear it named, since a strike-through isn't read out. */
export function OldPrice({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <s className={`tabular-nums text-zinc-500 dark:text-zinc-400 ${className}`}>
      <span className="sr-only">Звичайна ціна: </span>
      {children}
    </s>
  )
}
