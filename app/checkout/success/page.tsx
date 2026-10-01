import type { Metadata } from "next"
import { OrderConfirmation } from "@/components/shop/order-confirmation"

export const metadata: Metadata = {
  title: "Замовлення прийнято",
  description: "Дякуємо за замовлення",
  robots: { index: false },
}

export default function CheckoutSuccessPage() {
  return (
    <main id="content" className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <OrderConfirmation />
    </main>
  )
}
