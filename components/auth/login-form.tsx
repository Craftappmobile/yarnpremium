"use client"

import type React from "react"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") ?? "/admin/blog"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      // Genericize the credential signal to avoid account enumeration, but
      // surface an unconfirmed-email case since the user must act on it.
      if (signInError.message.toLowerCase().includes("email not confirmed")) {
        setError("Підтвердіть email за посиланням у листі, щоб увійти.")
      } else {
        setError("Невірний email або пароль.")
      }
      setLoading(false)
      return
    }

    router.push(next)
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">SINSERITA</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Вхід до панелі</h1>
        <p className="mt-1 text-sm text-zinc-500">Керування записами блогу</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm text-zinc-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm text-zinc-700">
            Пароль
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
        >
          {loading ? "Вхід…" : "Увійти"}
        </button>

        <p className="text-center text-sm text-zinc-500">
          Немає акаунта?{" "}
          <Link href="/auth/sign-up" className="text-zinc-900 underline underline-offset-2">
            Зареєструватися
          </Link>
        </p>
      </form>

      <p className="mt-6 text-center text-sm">
        <Link href="/" className="text-zinc-400 hover:text-zinc-600">
          ← До магазину
        </Link>
      </p>
    </div>
  )
}
