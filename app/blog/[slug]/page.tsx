import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import type { BlogPost } from "@/lib/blog"
import { formatDate, readingTime } from "@/lib/blog"

export const dynamic = "force-dynamic"

async function getPost(slug: string): Promise<BlogPost | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle()
  return (data as BlogPost) ?? null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return { title: "Статтю не знайдено — SINSERITA" }
  const description = post.excerpt ?? post.content.slice(0, 155)
  return {
    title: `${post.title} — SINSERITA`,
    description,
    openGraph: {
      title: post.title,
      description,
      type: "article",
      publishedTime: post.published_at ?? undefined,
      images: post.cover_image ? [{ url: post.cover_image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
      images: post.cover_image ? [post.cover_image] : undefined,
    },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()

  const paragraphs = post.content.split(/\n{2,}/).filter((p) => p.trim())

  return (
    <main className="min-h-screen bg-zinc-50">
      <article className="mx-auto max-w-2xl px-4 py-12">
        <Link href="/blog" className="text-sm text-zinc-400 hover:text-zinc-600">
          ← Усі записи
        </Link>

        <div className="mt-8 flex items-center gap-2 text-xs text-zinc-400">
          <span>{formatDate(post.published_at)}</span>
          <span>·</span>
          <span>{readingTime(post.content)} хв читання</span>
        </div>

        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900 text-balance">{post.title}</h1>

        {post.excerpt && <p className="mt-4 text-lg text-zinc-500 text-pretty">{post.excerpt}</p>}

        {post.cover_image && (
          <div className="mt-8 aspect-[16/9] overflow-hidden rounded-2xl bg-zinc-100">
            <img src={post.cover_image || "/placeholder.svg"} alt={post.title} className="h-full w-full object-cover" />
          </div>
        )}

        <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-zinc-700">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-pretty">
              {p}
            </p>
          ))}
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
