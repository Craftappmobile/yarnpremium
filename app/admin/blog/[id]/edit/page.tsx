import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { BlogPost } from "@/lib/blog"
import { PostEditor } from "@/components/admin/post-editor"

export const metadata = {
  title: "Редагувати запис — панель",
  robots: { index: false },
}

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from("blog_posts")
    .select(
      "id, slug, title, excerpt, content, cover_image, tags, status, source, published_at, created_at, updated_at, author_id",
    )
    .eq("id", id)
    .single()

  if (!data) notFound()

  return (
    <main className="min-h-screen bg-zinc-50">
      <PostEditor post={data as BlogPost} />
    </main>
  )
}
