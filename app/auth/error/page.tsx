import Link from "next/link"

export const metadata = {
  title: "Помилка входу — SINSERITA",
  robots: { index: false },
}

export default function AuthErrorPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Не вдалося увійти</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          Посилання недійсне або застаріле. Спробуйте увійти ще раз.
        </p>
        <Link
          href="/auth/login"
          className="mt-6 inline-block rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
        >
          До входу
        </Link>
      </div>
    </main>
  )
}
