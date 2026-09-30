import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { BlogPost } from "@/lib/blog"
import { formatDate } from "@/lib/blog"
import { LogoutButton } from "@/components/admin/logout-button"

export const metadata = {
  title: "Блог — панель",
  robots: { index: false },
}

export default async function AdminBlogPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Admin's own posts (drafts + published), newest first.
  const { data } = await supabase
    .from("blog_posts")
    .select("id, slug, title, excerpt, status, source, published_at, created_at, updated_at, tags, content, cover_image, author_id")
    .order("updated_at", { ascending: false })

  const posts = (data ?? []) as BlogPost[]

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">SINSERITA</p>
            <h1 className="text-lg font-semibold text-zinc-900">Записи блогу</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/blog/new"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Новий запис
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="mb-4 text-sm text-zinc-500">
          {user?.email} · {posts.length} {posts.length === 1 ? "запис" : "записів"}
        </p>

        {posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center">
            <p className="text-zinc-600">Ще немає записів.</p>
            <Link href="/admin/blog/new" className="mt-2 inline-block text-sm text-zinc-900 underline">
              Створити перший
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {posts.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/admin/blog/${post.id}/edit`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-zinc-300"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-zinc-900">{post.title}</span>
                      {post.source === "mcp" && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                          AI / MCP
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-zinc-400">/{post.slug}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 pl-4">
                    <span className="text-xs text-zinc-400">{formatDate(post.updated_at)}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        post.status === "published"
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {post.status === "published" ? "Опубліковано" : "Чернетка"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
