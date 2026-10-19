import Image from "next/image"
import Link from "next/link"
import type { Review } from "@/lib/reviews"

// Buyers' reviews (lib/reviews.ts): under a product on its page, and on /vidguky.

const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("uk-UA", { timeZone: "Europe/Kiev", month: "long", year: "numeric" })

export function ReviewCard({ review, currentSku }: { review: Review; currentSku?: string }) {
  const sku = review.skus[0]
  // On a product's own page its name goes without saying.
  const about = review.skus.includes(currentSku ?? "") ? "" : review.about || review.category
  return (
    <article id={review.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {review.photos.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {review.photos.slice(0, 3).map((p) => (
            <a
              key={p.id}
              href={p.src ?? `/review-photo/${p.id}`}
              target="_blank"
              rel="noopener"
              className="block aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
            >
              <Image
                src={p.src ?? `/review-photo/${p.id}`}
                alt={`Фото від покупця${review.about ? `: ${review.about}` : ""}`}
                width={p.w || 800}
                height={p.h || 800}
                sizes="(min-width: 768px) 160px, 30vw"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      )}
      <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{review.text}</p>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{review.author || "Покупець SINCERITA"}</span>
        {" · "}
        {monthYear(review.at)}
      </p>
      {about && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Про:{" "}
          {sku ? (
            <Link href={`/product/${encodeURIComponent(sku)}`} className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
              {about}
            </Link>
          ) : (
            about
          )}
        </p>
      )}
    </article>
  )
}

export function ProductReviews({ reviews, sku }: { reviews: Review[]; sku: string }) {
  if (reviews.length === 0) return null
  return (
    <section className="mt-12" aria-labelledby="reviews-title">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="reviews-title"
          className="text-sm font-semibold uppercase tracking-wide text-balance text-zinc-700 dark:text-zinc-300"
        >
          Відгуки покупців
        </h2>
        <Link href="/vidguky" className="shrink-0 text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
          Усі відгуки
        </Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} currentSku={sku} />
        ))}
      </div>
    </section>
  )
}
