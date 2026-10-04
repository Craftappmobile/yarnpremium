"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import Script from "next/script"
import { type CartItem, type Product, lineTotal } from "./data"
import type { Order } from "@/lib/order"
import { META_PIXEL_ID } from "@/lib/site"

// Google Analytics 4 and the Meta Pixel. Both run only on the shop's own
// domain: the *.vercel.app address (previews, tests) sends nothing, so test
// orders never reach the reports or the ad optimisation.

const GA_ID = "G-Y328SGZR2J"
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

// Never on the owner's pages: their address carries the statistics password.
const enabled = () =>
  typeof window !== "undefined" &&
  HOSTS.includes(window.location.hostname) &&
  !window.location.pathname.startsWith("/admin")

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
      {/* After the page has loaded: they're big and nothing waits for them, events are queued meanwhile. */}
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="lazyOnload" />
      <Script src="https://connect.facebook.net/en_US/fbevents.js" strategy="lazyOnload" />
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

function send(
  ga: string,
  meta: string,
  lines: Line[],
  extra: { transactionId?: string; listName?: string; params?: Record<string, string>; metaEventId?: string } = {},
) {
  if (!enabled()) return
  boot()
  const value = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100
  window.gtag?.("event", ga, {
    currency: CURRENCY,
    value,
    ...(extra.transactionId ? { transaction_id: extra.transactionId } : {}),
    ...(extra.listName ? { item_list_name: extra.listName } : {}),
    ...extra.params,
    items: lines.map((l) => ({
      item_id: l.sku,
      item_name: l.name,
      item_brand: l.brand || undefined,
      item_category: l.category || undefined,
      item_list_name: extra.listName,
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
    // Lets Meta merge this with the same event sent from the shop's server (lib/meta-capi.ts).
    extra.metaEventId ? { eventID: extra.metaEventId } : undefined,
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

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

/**
 * Asks the shop's server to send the same event to Meta (app/api/activity):
 * Safari and ad blockers stop part of the pixel's events. Same eventID, so Meta
 * counts it once. `keepalive` lets it finish when the buyer leaves the page.
 */
function sendFromServer(event: "ViewContent" | "AddToCart", id: string, p: Product, quantity: number) {
  fetch("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, id, sku: p.sku, quantity, url: window.location.href }),
    keepalive: true,
  }).catch(() => {})
}

export function trackViewItem(p: Product) {
  const metaEventId = `view-${randomId()}`
  send("view_item", "ViewContent", [productLine(p, p.minQty)], { metaEventId })
  if (enabled()) sendFromServer("ViewContent", metaEventId, p, p.minQty)
}

/** `listName` tells where the product was added from, e.g. «Консультант» for the assistant's cards. */
export function trackAddToCart(p: Product, quantity: number, listName?: string) {
  const metaEventId = `cart-${randomId()}`
  send("add_to_cart", "AddToCart", [productLine(p, quantity)], { listName, metaEventId })
  if (enabled()) sendFromServer("AddToCart", metaEventId, p, quantity)
}

export const trackBeginCheckout = (cart: CartItem[]) =>
  send("begin_checkout", "InitiateCheckout", cart.map((i) => productLine(i, i.quantity)))

/**
 * A placed order. GA4 counts it as a purchase. Meta gets Purchase only when
 * nothing is to be paid online; otherwise AddPaymentInfo, and the server sends
 * Purchase once WayForPay confirms the payment, so ads learn from paid orders.
 * `assisted`: the buyer wrote to the shopping assistant before ordering.
 */
export function trackPurchase(order: Order, fallbackId: string, assisted = false) {
  const id = String(order.number ?? fallbackId)
  const payLater = order.payment.now > 0
  send(
    "purchase",
    payLater ? "AddPaymentInfo" : "Purchase",
    order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      total: i.total ?? i.price * i.quantity,
    })),
    {
      transactionId: id,
      metaEventId: `${payLater ? "pay" : "order"}-${id}`,
      params: { assistant_used: assisted ? "yes" : "no" },
    },
  )
}

/** First message of a conversation with the shopping assistant: Meta's Contact (the server sends it too). */
export function trackAssistantContact(conversationId: string) {
  if (!enabled()) return
  boot()
  window.fbq?.("track", "Contact", { content_name: "Консультант" }, { eventID: `chat-${conversationId}` })
}

/**
 * A product video started or watched to the end: GA4's video_start /
 * video_complete. Meta gets VideoComplete, so an audience of people who
 * watched the yarn or its sample to the end can be built for ads.
 */
export function trackVideo(step: "start" | "complete", role: "review" | "sample", sku: string) {
  if (!enabled()) return
  boot()
  window.gtag?.("event", `video_${step}`, {
    video_title: role === "review" ? "Відеоогляд" : "Зразок",
    video_provider: "google_drive",
    video_type: role,
    item_id: sku,
  })
  if (step === "complete") {
    window.fbq?.("trackCustom", "VideoComplete", { content_ids: [sku], content_type: "product", video_type: role })
  }
}

/**
 * Use of the shopping assistant, to GA4 only: assistant_open, assistant_message,
 * assistant_products_shown, assistant_checkout_click.
 */
export function trackAssistant(event: string, params: Record<string, string | number> = {}) {
  if (!enabled()) return
  boot()
  window.gtag?.("event", event, params)
}
