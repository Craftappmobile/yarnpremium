import type { Metadata } from "next"
import Link from "next/link"
import { latestReviews } from "@/lib/reviews"
import { redisConfigured } from "@/lib/redis"
import { ReviewCard } from "@/components/shop/reviews"

// Every buyer's review (lib/reviews.ts), newest first, 30 to a page.

export const dynamic = "force-dynamic"

const PER_PAGE = 30

export const metadata: Metadata = {
  title: "Відгуки покупців",
  description: "Що пишуть покупці SINCERITA про італійську пряжу і вироби з неї: відгуки з фото готових робіт.",
  alternates: { canonical: "/vidguky" },
  openGraph: { url: "/vidguky" },
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const page = Math.max(1, Math.floor(Number(params.page)) || 1)
  const { reviews, total } = redisConfigured()
    ? await latestReviews((page - 1) * PER_PAGE, PER_PAGE).catch(() => ({ reviews: [], total: 0 }))
    : { reviews: [], total: 0 }
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <main id="content" className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-600">
            ← До магазину
          </Link>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">SINCERITA</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 text-balance dark:text-zinc-50">
            Відгуки покупців
          </h1>
          <p className="mt-2 max-w-lg text-zinc-500 text-pretty">
            Що пишуть нам після замовлення: про пряжу, доставку і готові вироби.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {reviews.length === 0 ? (
          <p className="py-16 text-center text-zinc-500">Відгуків поки немає.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {reviews.map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Сторінки відгуків" className="mt-8 flex items-center justify-between text-sm">
            {page > 1 ? (
              <Link href={page === 2 ? "/vidguky" : `/vidguky?page=${page - 1}`} className="underline underline-offset-2">
                ← Новіші
              </Link>
            ) : (
              <span />
            )}
            <span className="text-zinc-500">
              Сторінка {page} з {pages}
            </span>
            {page < pages ? (
              <Link href={`/vidguky?page=${page + 1}`} className="underline underline-offset-2">
                Старіші →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </main>
  )
}
