import type { Metadata } from "next"
import { Checkout } from "@/components/shop/checkout"

export const metadata: Metadata = {
  title: "Оформлення замовлення | SINSERITA",
  description: "Оформлення замовлення пряжі SINSERITA",
}

export default function CheckoutPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Checkout />
    </main>
  )
}
