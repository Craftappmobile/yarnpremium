"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { type BlogPost, slugify } from "@/lib/blog"

interface PostEditorProps {
  post?: BlogPost
}

export function PostEditor({ post }: PostEditorProps) {
  const router = useRouter()
  const isEdit = Boolean(post)

  const [title, setTitle] = useState(post?.title ?? "")
  const [slug, setSlug] = useState(post?.slug ?? "")
  const [slugTouched, setSlugTouched] = useState(Boolean(post?.slug))
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "")
  const [coverImage, setCoverImage] = useState(post?.cover_image ?? "")
  const [tags, setTags] = useState((post?.tags ?? []).join(", "))
  const [content, setContent] = useState(post?.content ?? "")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const onTitleChange = (value: string) => {
    setTitle(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  const save = async (status: "draft" | "published") => {
    setSaving(true)
    setError("")

    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.push("/auth/login")
      return
    }

    const payload = {
      title: title.trim(),
      slug: slug.trim() || slugify(title),
      excerpt: excerpt.trim() || null,
      cover_image: coverImage.trim() || null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      content,
      status,
      author_id: user.id,
      published_at: status === "published" ? (post?.published_at ?? new Date().toISOString()) : null,
    }

    if (!payload.title) {
      setError("Вкажіть заголовок")
      setSaving(false)
      return
    }

    const result = isEdit
      ? await supabase.from("blog_posts").update(payload).eq("id", post!.id)
      : await supabase.from("blog_posts").insert(payload)

    if (result.error) {
      setError(
        result.error.code === "23505"
          ? "Запис із таким slug уже існує — змініть його."
          : result.error.message,
      )
      setSaving(false)
      return
    }

    router.push("/admin/blog")
    router.refresh()
  }

  const remove = async () => {
    if (!post || !confirm("Видалити цей запис?")) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from("blog_posts").delete().eq("id", post.id)
    router.push("/admin/blog")
    router.refresh()
  }

  const inputCls =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/admin/blog" className="text-sm text-zinc-400 hover:text-zinc-600">
          ← До списку
        </Link>
        {isEdit && (
          <button type="button" onClick={remove} className="text-sm text-red-500 hover:text-red-600">
            Видалити
          </button>
        )}
      </div>

      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">{isEdit ? "Редагувати запис" : "Новий запис"}</h1>

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm text-zinc-700">Заголовок</label>
          <input value={title} onChange={(e) => onTitleChange(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-zinc-700">Slug (адреса)</label>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugTouched(true)
            }}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-zinc-400">/blog/{slug || "…"}</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-zinc-700">Короткий анонс</label>
          <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} className={inputCls} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-zinc-700">Обкладинка (URL)</label>
          <input value={coverImage} onChange={(e) => setCoverImage(e.target.value)} className={inputCls} placeholder="https://…" />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-zinc-700">Теги (через кому)</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="в'язання, поради" />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-zinc-700">Текст</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            className={`${inputCls} font-mono leading-relaxed`}
            placeholder="Пишіть тут. Порожній рядок розділяє абзаци."
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => save("published")}
            disabled={saving}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {saving ? "Збереження…" : "Опублікувати"}
          </button>
          <button
            type="button"
            onClick={() => save("draft")}
            disabled={saving}
            className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
          >
            Зберегти чернетку
          </button>
        </div>
      </div>
    </div>
  )
}
