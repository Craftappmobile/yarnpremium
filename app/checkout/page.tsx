import type { Metadata } from "next"
import { Checkout } from "@/components/shop/checkout"

export const metadata: Metadata = {
  title: "Оформлення замовлення",
  robots: { index: false },
}

export default function CheckoutPage() {
  return (
    <main id="content" className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Checkout />
    </main>
  )
}
