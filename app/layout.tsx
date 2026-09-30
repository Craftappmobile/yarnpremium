import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import type React from "react"
import { CartProvider } from "@/components/shop/cart-context"
import { WishlistProvider } from "@/components/shop/wishlist-context"

const inter = Inter({ subsets: ["latin", "cyrillic"] })

export const metadata: Metadata = {
  title: "SINSERITA — магазин пряжі",
  description: "Стокова пряжа для в'язання: широкий вибір кольорів та метражу. Меринос, кашемір, альпака, шовк.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="uk" className="bg-zinc-50 dark:bg-zinc-950">
      <body className={inter.className}>
        <CartProvider>
          <WishlistProvider>{children}</WishlistProvider>
        </CartProvider>
      </body>
    </html>
  )
}

