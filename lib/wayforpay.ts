// Server-only: online payment through WayForPay (https://wiki.wayforpay.com).
// After an order is placed the buyer is sent to WayForPay's payment page with
// a signed form; WayForPay then calls serviceUrl with the result, and the
// matching KeyCRM payment is marked as paid.

import { createHmac } from "node:crypto"
import { keycrmGet, keycrmSend } from "@/lib/keycrm"
import { redis } from "@/lib/redis"
import { SITE_INDEXABLE, SITE_URL } from "@/lib/site"
import { onlinePaymentMethodId } from "@/lib/keycrm-order"
import type { Order } from "@/lib/order"
import { sendOrderPaid } from "@/lib/meta-capi"

export const PAY_URL = "https://secure.wayforpay.com/pay"

/**
 * WayForPay's public test merchant: payments go through the full flow with
 * test cards and no money moves. Used everywhere but production on the shop's
 * own domain, so previews and the *.vercel.app address never charge anyone.
 */
const TEST_MERCHANT = { account: "test_merch_n1", secret: "flk3409refn54t54t*FNJRET", domain: "www.market.ua" }

interface Merchant {
  account: string
  secret: string
  domain: string
  live: boolean
}

export function merchant(): Merchant {
  const secret = process.env.WAYFORPAY_SECRET_KEY
  if (process.env.VERCEL_ENV === "production" && SITE_INDEXABLE && secret) {
    return {
      account: process.env.WAYFORPAY_MERCHANT_ACCOUNT || "yarnpremium_com_ua",
      secret,
      domain: new URL(SITE_URL).hostname,
      live: true,
    }
  }
  return { ...TEST_MERCHANT, live: false }
}

/** HMAC-MD5 of the values joined by ";" — WayForPay's signature. */
export function sign(secret: string, values: (string | number)[]): string {
  return createHmac("md5", secret).update(values.join(";"), "utf8").digest("hex")
}

const money = (n: number) => Math.round(n * 100) / 100

/**
 * Lines of the payment, which WayForPay also prints on the fiscal receipt.
 * Each order line is one position at its full price (count 1), so the sum
 * matches to the kopeck; a spool's discounted leftover is its own position.
 * A cash-on-delivery prepayment is a single «Передоплата» position.
 */
export function paymentLines(order: Order, amount: number): { name: string; price: number; count: number }[] {
  if (amount < order.total) {
    return [{ name: `Передоплата за замовлення №${order.number}`, price: amount, count: 1 }]
  }
  return order.items.flatMap((i) => {
    const total = i.total ?? money(i.price * i.quantity)
    if (!i.tail) return [{ name: `${i.name} (${i.quantity} ${i.unit})`, price: total, count: 1 }]
    const main = money(i.price * (i.quantity - i.tail))
    return [
      { name: `${i.name} (${i.quantity - i.tail} ${i.unit})`, price: main, count: 1 },
      { name: `${i.name} — залишок бобіни ${i.tail} ${i.unit}, знижка 10%`, price: money(total - main), count: 1 },
    ]
  })
}

/** What the site keeps about a payment attempt, by its orderReference. */
interface PaymentRecord {
  siteOrderId: string
  keycrmId: number
  method: Order["payment"]["method"]
  amount: number
  live: boolean
}

const PAYMENT_KEY = (ref: string) => `payment:${ref}`
const ORDER_KEY = (id: string) => `order:${id}`

/**
 * A signed payment form for the online part of an order. Each attempt gets its
 * own orderReference (WayForPay won't take the same one twice), all tied to
 * the same KeyCRM order. `origin` is the address the buyer is on, so they come
 * back to the same site (and their saved order) after paying.
 */
export async function createPayment(
  order: Order,
  siteOrderId: string,
  origin: string,
): Promise<{ url: string; fields: [string, string][] }> {
  const m = merchant()
  const amount = order.payment.now
  const lines = paymentLines(order, amount)
  const reference = `SIN${order.number}-${Date.now().toString(36)}`
  const orderDate = Math.floor(Date.now() / 1000)

  const r = await redis()
  const record: PaymentRecord = { siteOrderId, keycrmId: order.number!, method: order.payment.method, amount, live: m.live }
  await r.set(PAYMENT_KEY(reference), JSON.stringify(record), { EX: 30 * 86400 })

  const signature = sign(m.secret, [
    m.account,
    m.domain,
    reference,
    orderDate,
    amount,
    "UAH",
    ...lines.map((l) => l.name),
    ...lines.map((l) => l.count),
    ...lines.map((l) => l.price),
  ])
  const fields: [string, string][] = [
    ["merchantAccount", m.account],
    ["merchantAuthType", "SimpleSignature"],
    ["merchantDomainName", m.domain],
    ["merchantSignature", signature],
    ["merchantTransactionSecureType", "AUTO"],
    ["language", "UA"],
    ["orderReference", reference],
    ["orderDate", String(orderDate)],
    ["amount", String(amount)],
    ["currency", "UAH"],
    ...lines.map((l): [string, string] => ["productName[]", l.name]),
    ...lines.map((l): [string, string] => ["productPrice[]", String(l.price)]),
    ...lines.map((l): [string, string] => ["productCount[]", String(l.count)]),
    ["clientFirstName", order.customer.firstName],
    ["clientLastName", order.customer.lastName],
    ["clientPhone", order.customer.phone.replace(/\D/g, "")],
    ...(order.customer.email ? [["clientEmail", order.customer.email] as [string, string]] : []),
    [
      "returnUrl",
      `${origin}/api/payments/wayforpay/return?order=${encodeURIComponent(siteOrderId)}&ref=${encodeURIComponent(reference)}`,
    ],
    ["serviceUrl", `${origin}/api/payments/wayforpay/callback`],
  ]
  return { url: PAY_URL, fields }
}

/** A payment result from WayForPay (serviceUrl call or the buyer's return). */
export interface PaymentResult {
  merchantAccount?: string
  orderReference?: string
  merchantSignature?: string
  amount?: number | string
  currency?: string
  authCode?: string
  cardPan?: string
  transactionStatus?: string
  reasonCode?: number | string
  reason?: string
}

/**
 * Whether a result really comes from WayForPay for our merchant: the secret it
 * is signed with, or null.
 */
export function verifyResult(p: PaymentResult): string | null {
  const m = merchant()
  // A result signed with the other merchant's key (test vs live) is checked against it too,
  // so test payments made before the switch still resolve.
  const secrets = m.live ? [m.secret, TEST_MERCHANT.secret] : [m.secret]
  const expected = (secret: string) =>
    sign(secret, [
      p.merchantAccount ?? "",
      p.orderReference ?? "",
      p.amount ?? "",
      p.currency ?? "",
      p.authCode ?? "",
      p.cardPan ?? "",
      p.transactionStatus ?? "",
      p.reasonCode ?? "",
    ])
  if (!p.merchantSignature) return null
  return secrets.find((s) => expected(s) === p.merchantSignature) ?? null
}

/** The answer WayForPay expects from serviceUrl, so it stops retrying; signed with the result's secret. */
export function acceptResponse(orderReference: string, secret: string) {
  const time = Math.floor(Date.now() / 1000)
  return { orderReference, status: "accept", time, signature: sign(secret, [orderReference, "accept", time]) }
}

interface KeycrmPayment {
  id: number
  payment_method_id: number
  amount: number
  status: string
}

/**
 * Books an approved payment: marks the order's waiting KeyCRM payment as paid
 * (or adds one if none matches) and the site order as paid. Safe to call more
 * than once for the same payment.
 */
export async function recordApprovedPayment(p: PaymentResult): Promise<boolean> {
  const ref = p.orderReference ?? ""
  const r = await redis()
  const raw = await r.get(PAYMENT_KEY(ref))
  if (!raw) return false
  const record = JSON.parse(raw) as PaymentRecord
  // Only one of the serviceUrl call and the buyer's return books it.
  if (!(await r.set(`${PAYMENT_KEY(ref)}:booked`, "1", { NX: true, EX: 30 * 86400 }))) return true

  try {
    const description = [
      record.live ? "WayForPay" : "ТЕСТОВА оплата WayForPay (гроші не списано)",
      ref,
      p.cardPan ? `картка ${p.cardPan}` : "",
    ]
      .filter(Boolean)
      .join(", ")
    const order = await keycrmGet<{ payments?: KeycrmPayment[] }>(`/order/${record.keycrmId}`, { include: "payments" })
    const waiting = (order.payments ?? []).find(
      (x) =>
        x.status !== "paid" &&
        x.payment_method_id === onlinePaymentMethodId(record.method) &&
        Math.abs(Number(x.amount) - record.amount) < 0.01,
    )
    if (waiting) {
      await keycrmSend("PUT", `/order/${record.keycrmId}/payment/${waiting.id}`, { status: "paid", description })
    } else {
      await keycrmSend("POST", `/order/${record.keycrmId}/payment`, {
        payment_method_id: onlinePaymentMethodId(record.method),
        amount: record.amount,
        status: "paid",
        description,
      })
    }
  } catch (e) {
    // Let the next WayForPay retry try again.
    await r.del(`${PAYMENT_KEY(ref)}:booked`)
    throw e
  }

  const siteOrder = await r.get(ORDER_KEY(record.siteOrderId))
  if (siteOrder) {
    const order = JSON.parse(siteOrder) as Order
    order.payment.paid = true
    await r.set(ORDER_KEY(record.siteOrderId), JSON.stringify(order), { KEEPTTL: true })
    // The order is paid: the Purchase Meta's ads learn from.
    await sendOrderPaid(order, record.siteOrderId, { test: !record.live })
  } else {
    console.error(`[wayforpay] ${ref}: site order ${record.siteOrderId} expired, no Purchase sent to Meta`)
  }
  console.log(`[wayforpay] ${ref}: ${record.amount} ₴ paid for KeyCRM order ${record.keycrmId}${record.live ? "" : " (test)"}`)
  return true
}

const STATUS_KEY = (ref: string) => `${PAYMENT_KEY(ref)}:status`

/** Remembers the latest status WayForPay reported to serviceUrl, for the buyer's return. */
export async function rememberStatus(p: PaymentResult): Promise<void> {
  if (!p.orderReference || !p.transactionStatus) return
  await (await redis()).set(STATUS_KEY(p.orderReference), p.transactionStatus, { EX: 30 * 86400 })
}

/**
 * The payment's status for the buyer's return page: what serviceUrl reported,
 * else WayForPay's own answer to CHECK_STATUS. Null when neither is known.
 */
export async function paymentStatus(ref: string): Promise<PaymentResult | null> {
  const r = await redis()
  const known = await r.get(STATUS_KEY(ref))
  if (known) return { orderReference: ref, transactionStatus: known }
  const raw = await r.get(PAYMENT_KEY(ref))
  if (!raw) return null
  const m = (JSON.parse(raw) as PaymentRecord).live ? merchant() : { ...TEST_MERCHANT, live: false }
  const res = await fetch("https://api.wayforpay.com/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionType: "CHECK_STATUS",
      merchantAccount: m.account,
      orderReference: ref,
      merchantSignature: sign(m.secret, [m.account, ref]),
      apiVersion: 1,
    }),
    signal: AbortSignal.timeout(8000),
  })
  const status = (await res.json()) as PaymentResult
  return status.transactionStatus ? { ...status, orderReference: ref } : null
}

/**
 * Reads a WayForPay POST body: JSON (serviceUrl, sometimes sent as a form
 * field name) or a form — multipart for the buyer's return.
 */
export async function readResult(req: Request): Promise<PaymentResult> {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData()
    return Object.fromEntries([...form].filter(([, v]) => typeof v === "string")) as PaymentResult
  }
  const text = await req.text()
  try {
    return JSON.parse(text)
  } catch {
    const form = new URLSearchParams(text)
    const keys = [...form.keys()]
    if (keys.length === 1 && keys[0].startsWith("{")) return JSON.parse(keys[0])
    return Object.fromEntries(form) as PaymentResult
  }
}
