import { Suspense } from "react"
import { LoginForm } from "@/components/auth/login-form"

export const metadata = {
  title: "Вхід — SINSERITA",
  robots: { index: false },
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-16">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}
