import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"
import type React from "react"
import { CartProvider } from "@/components/shop/cart-context"
import { WishlistProvider } from "@/components/shop/wishlist-context"
import { UtmCapture } from "@/components/shop/utm-capture"
import { Analytics } from "@/components/shop/analytics"
import { MotionProvider } from "@/components/shop/motion-provider"
import { Assistant } from "@/components/shop/assistant"
import { BRAND, HOME_TITLE, SITE_INDEXABLE, SITE_URL } from "@/lib/site"

// Inter, Latin and Cyrillic only (Google's subsets of the variable font, OFL).
// Each face is limited to its own characters, so anything else — the «₴» sign
// in every price, above all — is drawn with the system font instead of pulling
// in two more subsets (≈110 KB) on every visit.
const interLatin = localFont({
  src: "./fonts/inter-latin.woff2",
  weight: "100 900",
  display: "swap",
  // Its metric-matched fallback (Arial) would cover Cyrillic too and take it
  // from the Cyrillic face below; the Cyrillic face's fallback serves both.
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
})
const interCyrillic = localFont({
  src: "./fonts/inter-cyrillic.woff2",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
})
const fontFamily = `${interLatin.style.fontFamily}, ${interCyrillic.style.fontFamily}, system-ui, sans-serif`

const DESCRIPTION =
  "Італійська пряжа преміум якості для вʼязання: меринос, кашемір, шовк, альпака. Продаж на вагу від 100 г, доставка Новою Поштою та Укрпоштою."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: `%s — ${BRAND}` },
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
      <body className="antialiased" style={{ fontFamily }}>
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-zinc-900 focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white"
        >
          Перейти до вмісту
        </a>
        <UtmCapture />
        <Analytics />
        <MotionProvider>
          <CartProvider>
            <WishlistProvider>{children}</WishlistProvider>
            <Assistant />
          </CartProvider>
        </MotionProvider>
      </body>
    </html>
  )
}

