import { PostEditor } from "@/components/admin/post-editor"

export const metadata = {
  title: "Новий запис — панель",
  robots: { index: false },
}

export default function NewPostPage() {
  return (
    <main className="min-h-screen bg-zinc-50">
      <PostEditor />
    </main>
  )
}
