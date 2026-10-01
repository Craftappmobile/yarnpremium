import Link from "next/link"
import { getAllPosts, formatDate, readingTime } from "@/lib/blog"

export const metadata = {
  title: "Журнал",
  description: "Поради з в'язання, гайди по пряжі та історії майстрів.",
  alternates: { canonical: "/blog" },
  openGraph: { url: "/blog" },
}

function DraftBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Чернетка</span>
  )
}

export default function BlogPage() {
  const posts = getAllPosts()
  const [featured, ...rest] = posts

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-600">
            ← До магазину
          </Link>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">SINSERITA</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 text-balance">Журнал</h1>
          <p className="mt-2 max-w-lg text-zinc-500 text-pretty">
            Поради з в'язання, гайди по пряжі та історії майстрів.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {posts.length === 0 ? (
          <p className="py-16 text-center text-zinc-500">Записів поки немає. Незабаром тут з'являться статті.</p>
        ) : (
          <>
            {featured && (
              <Link
                href={`/blog/${featured.slug}`}
                className="group mb-12 block overflow-hidden rounded-2xl border border-zinc-200 bg-white md:grid md:grid-cols-2"
              >
                <div className="aspect-[16/10] overflow-hidden bg-zinc-100 md:aspect-auto md:h-full">
                  <img
                    src={featured.cover || "/placeholder.svg?height=500&width=800&query=yarn%20knitting"}
                    alt={featured.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-col justify-center p-8">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>{formatDate(featured.date)}</span>
                    <span>·</span>
                    <span>{readingTime(featured.content)} хв читання</span>
                    {featured.draft && <DraftBadge />}
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold text-zinc-900 text-balance">{featured.title}</h2>
                  {featured.excerpt && <p className="mt-3 text-zinc-600 text-pretty">{featured.excerpt}</p>}
                  <span className="mt-4 text-sm font-medium text-zinc-900 underline underline-offset-4">
                    Читати далі
                  </span>
                </div>
              </Link>
            )}

            {rest.length > 0 && (
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((post) => (
                  <Link key={post.slug} href={`/blog/${post.slug}`} className="group block">
                    <div className="aspect-[4/3] overflow-hidden rounded-xl bg-zinc-100">
                      <img
                        src={post.cover || "/placeholder.svg?height=300&width=400&query=yarn%20skein"}
                        alt={post.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                      <span>{formatDate(post.date)}</span>
                      <span>·</span>
                      <span>{readingTime(post.content)} хв</span>
                      {post.draft && <DraftBadge />}
                    </div>
                    <h3 className="mt-1.5 text-lg font-medium text-zinc-900 text-balance">{post.title}</h3>
                    {post.excerpt && <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{post.excerpt}</p>}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
