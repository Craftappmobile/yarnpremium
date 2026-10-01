"use client"

import { useEffect } from "react"
import Link from "next/link"

// Shown instead of a blank page when a page fails to render (e.g. the catalog is unreachable).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-4 text-center">
      <h1 className="text-2xl font-semibold text-balance text-zinc-900">Не вдалося завантажити сторінку</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-pretty text-zinc-500">
        Спробуйте ще раз за мить. Якщо не допоможе — напишіть або зателефонуйте нам, і ми оформимо замовлення вручну.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          Спробувати ще раз
        </button>
        <Link
          href="/contacts"
          className="rounded-md border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100"
        >
          Контакти
        </Link>
      </div>
    </main>
  )
}
