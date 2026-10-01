"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import Script from "next/script"
import { type CartItem, type Product, lineTotal } from "./data"
import type { Order } from "@/lib/order"

// Google Analytics 4 and the Meta Pixel. Both run only on the shop's own
// domain: the *.vercel.app address (previews, tests) sends nothing, so test
// orders never reach the reports or the ad optimisation.

const GA_ID = "G-Y328SGZR2J"
/** «KeyCRM+YanrnPremium» in Meta Business: the pixel the old site already feeds, so audiences carry over. */
const META_PIXEL_ID = "1629906027721243"
/** Hosts where analytics run; NEXT_PUBLIC_ANALYTICS_HOSTS (comma-separated) overrides, e.g. for a local check. */
const HOSTS = (process.env.NEXT_PUBLIC_ANALYTICS_HOSTS || "yarnpremium.com.ua,www.yarnpremium.com.ua").split(",")
const CURRENCY = "UAH"

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[]; push: Fbq; loaded: boolean; version: string }

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    fbq?: Fbq
    _fbq?: Fbq
  }
}

const enabled = () => typeof window !== "undefined" && HOSTS.includes(window.location.hostname)

/**
 * Sets up both tags' command queues (the standard gtag and pixel snippets,
 * minus loading the scripts). Called before the first event, so an event sent
 * while the scripts are still loading (a product view on page open) is queued,
 * not lost; the scripts pick the queue up when they arrive.
 */
function boot() {
  if (window.gtag) return
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    // gtag.js expects the arguments object itself.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag("js", new Date())
  window.gtag("config", GA_ID)

  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args)
    else fbq.queue.push(args)
  } as Fbq
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = "2.0"
  fbq.queue = []
  window.fbq = window._fbq = fbq
  fbq("init", META_PIXEL_ID)
  fbq("track", "PageView")
}

/** Loads both tags on the live domain and reports page changes to the pixel (GA4 follows them by itself). */
export function Analytics() {
  const [on, setOn] = useState(false)
  const pathname = usePathname()
  const first = useRef(true)

  useEffect(() => {
    if (!enabled()) return
    boot()
    setOn(true)
  }, [])

  useEffect(() => {
    // The first page view is sent by the pixel's own setup.
    if (first.current) {
      first.current = false
      return
    }
    window.fbq?.("track", "PageView")
  }, [pathname])

  if (!on) return null
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script src="https://connect.facebook.net/en_US/fbevents.js" strategy="afterInteractive" />
    </>
  )
}

interface Line {
  sku: string
  name: string
  price: number
  quantity: number
  /** Price of the line, discounts included. */
  total: number
  category?: string
  brand?: string
}

function send(ga: string, meta: string, lines: Line[], extra: { transactionId?: string } = {}) {
  if (!enabled()) return
  boot()
  const value = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100
  window.gtag?.("event", ga, {
    currency: CURRENCY,
    value,
    ...(extra.transactionId ? { transaction_id: extra.transactionId } : {}),
    items: lines.map((l) => ({
      item_id: l.sku,
      item_name: l.name,
      item_brand: l.brand || undefined,
      item_category: l.category || undefined,
      price: l.price,
      quantity: l.quantity,
    })),
  })
  window.fbq?.(
    "track",
    meta,
    {
      currency: CURRENCY,
      value,
      content_type: "product",
      content_ids: lines.map((l) => l.sku),
      contents: lines.map((l) => ({ id: l.sku, quantity: l.quantity, item_price: l.price })),
      num_items: lines.length,
    },
    // Lets Meta merge this with the same event sent from KeyCRM's server, if it sends one.
    extra.transactionId ? { eventID: `order-${extra.transactionId}` } : undefined,
  )
}

const productLine = (p: Product | CartItem, quantity: number): Line => ({
  sku: p.sku,
  name: p.name,
  price: p.price,
  quantity,
  total: lineTotal(p, quantity),
  category: p.category,
  brand: p.brand,
})

export const trackViewItem = (p: Product) => send("view_item", "ViewContent", [productLine(p, p.minQty)])

export const trackAddToCart = (p: Product, quantity: number) =>
  send("add_to_cart", "AddToCart", [productLine(p, quantity)])

export const trackBeginCheckout = (cart: CartItem[]) =>
  send("begin_checkout", "InitiateCheckout", cart.map((i) => productLine(i, i.quantity)))

export const trackPurchase = (order: Order, fallbackId: string) =>
  send(
    "purchase",
    "Purchase",
    order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      total: i.total ?? i.price * i.quantity,
    })),
    { transactionId: String(order.number ?? fallbackId) },
  )
