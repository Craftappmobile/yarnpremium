import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import type React from "react"
import { CartProvider } from "@/components/shop/cart-context"
import { WishlistProvider } from "@/components/shop/wishlist-context"
import { UtmCapture } from "@/components/shop/utm-capture"
import { MotionProvider } from "@/components/shop/motion-provider"
import { BRAND, SITE_INDEXABLE, SITE_URL } from "@/lib/site"

const inter = Inter({ subsets: ["latin", "cyrillic"] })

const DESCRIPTION =
  "Італійська пряжа преміум якості для в'язання: меринос, кашемір, шовк, альпака. Продаж на вагу від 100 г, доставка Новою Поштою та Укрпоштою."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND} — італійська пряжа преміум якості`, template: `%s — ${BRAND}` },
  description: DESCRIPTION,
  applicationName: BRAND,
  openGraph: { type: "website", siteName: BRAND, locale: "uk_UA", description: DESCRIPTION },
  twitter: { card: "summary_large_image" },
  // Until the shop moves to its own domain, keep the *.vercel.app address out of search.
  robots: SITE_INDEXABLE ? undefined : { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#fafafa",
  colorScheme: "light",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="uk" className="bg-zinc-50 dark:bg-zinc-950">
      <body className={`${inter.className} antialiased`}>
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-zinc-900 focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white"
        >
          Перейти до вмісту
        </a>
        <UtmCapture />
        <MotionProvider>
          <CartProvider>
            <WishlistProvider>{children}</WishlistProvider>
          </CartProvider>
        </MotionProvider>
      </body>
    </html>
  )
}

