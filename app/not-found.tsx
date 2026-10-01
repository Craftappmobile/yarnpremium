import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Сторінку не знайдено",
  robots: { index: false },
}

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">404</p>
      <h1 className="mt-3 text-2xl font-semibold text-balance text-zinc-900">Сторінку не знайдено</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-pretty text-zinc-500">
        Можливо, цю пряжу вже розпродано і прибрано з каталогу, або посилання застаріло.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-md bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          До каталогу
        </Link>
        <Link
          href="/contacts"
          className="rounded-md border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100"
        >
          Написати нам
        </Link>
      </div>
    </main>
  )
}
