import { SignUpForm } from "@/components/auth/sign-up-form"

export const metadata = {
  title: "Реєстрація — SINSERITA",
  robots: { index: false },
}

export default function SignUpPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-16">
      <SignUpForm />
    </main>
  )
}
