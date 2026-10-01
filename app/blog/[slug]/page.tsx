import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { getAllPosts, getPost, formatDate, readingTime } from "@/lib/blog"

// Only posts that exist in content/blog render; other URLs 404.
export const dynamicParams = false

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return { title: "Статтю не знайдено" }
  const description = post.excerpt ?? post.content.slice(0, 155)
  return {
    title: post.title,
    alternates: { canonical: `/blog/${post.slug}` },
    description,
    robots: post.draft ? { index: false } : undefined,
    openGraph: {
      title: post.title,
      description,
      type: "article",
      url: `/blog/${post.slug}`,
      publishedTime: post.date,
      images: post.cover ? [{ url: post.cover }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
      images: post.cover ? [post.cover] : undefined,
    },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()

  return (
    <main id="content" className="min-h-screen bg-zinc-50">
      <article className="mx-auto max-w-2xl px-4 py-12">
        <Link href="/blog" className="text-sm text-zinc-500 hover:text-zinc-600">
          ← Усі записи
        </Link>

        <div className="mt-8 flex items-center gap-2 text-xs text-zinc-500">
          <span>{formatDate(post.date)}</span>
          <span>·</span>
          <span>{readingTime(post.content)} хв читання</span>
          {post.draft && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              Чернетка
            </span>
          )}
        </div>

        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900 text-balance">{post.title}</h1>

        {post.excerpt && <p className="mt-4 text-lg text-zinc-500 text-pretty">{post.excerpt}</p>}

        {post.cover && (
          <div className="mt-8 aspect-[16/9] overflow-hidden rounded-2xl bg-zinc-100">
            <img src={post.cover} alt={post.title} className="h-full w-full object-cover" />
          </div>
        )}

        <div className="prose prose-zinc mt-8 max-w-none text-[15px] leading-relaxed prose-headings:font-semibold prose-a:underline-offset-4 prose-img:rounded-xl">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
        </div>

        {post.tags.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2 border-t border-zinc-200 pt-6">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </article>
    </main>
  )
}
