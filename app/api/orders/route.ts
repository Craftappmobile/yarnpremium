import { type NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { readProducts, reserveStock } from "@/lib/catalog"
import { createKeycrmOrder, isTestOrderEnvironment } from "@/lib/keycrm-order"
import { keycrmConfigured } from "@/lib/keycrm"
import { redis, redisConfigured } from "@/lib/redis"
import { SHOP_PHONE } from "@/lib/site"
import { isValidQuantity } from "@/components/shop/data"
import {
  effectivePaymentMethod,
  normalizePhone,
  paymentSplit,
  validateOrderFields,
  type Order,
  type OrderRequest,
  type StockChange,
} from "@/lib/order"

// Places an order: re-checks prices and stock against the catalog, creates the
// order in KeyCRM and takes the quantities off the site's stock.
export const dynamic = "force-dynamic"
export const maxDuration = 60

const ORDER_KEY = (id: string) => `order:${id}`
/** Order attempts allowed per visitor IP in RATE_WINDOW seconds. */
const RATE_LIMIT = 10
const RATE_WINDOW = 600
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const money = (n: number) => Math.round(n * 100) / 100

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as OrderRequest | null
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Не вдалося надіслати замовлення. Оновіть сторінку і спробуйте ще раз." }, { status: 400 })
  // Bots fill every field; people never see this one.
  if (body.website) return NextResponse.json({ error: "Не вдалося надіслати замовлення. Оновіть сторінку і спробуйте ще раз." }, { status: 400 })

  const id = text(body.id, 64)
  const items = Array.isArray(body.items) ? body.items : []
  if (!/^[\w-]{8,64}$/.test(id) || items.length === 0 || items.length > 50) {
    return NextResponse.json({ error: "Не вдалося надіслати замовлення. Оновіть сторінку і спробуйте ще раз." }, { status: 400 })
  }
  const lines = items.map((i) => ({ sku: text(i?.sku, 64), quantity: Number(i?.quantity) }))
  if (lines.some((l) => !l.sku || !Number.isFinite(l.quantity) || l.quantity <= 0)) {
    return NextResponse.json({ error: "Не вдалося надіслати замовлення. Оновіть сторінку і спробуйте ще раз." }, { status: 400 })
  }

  const customer = {
    firstName: text(body.customer?.firstName, 100),
    lastName: text(body.customer?.lastName, 100),
    phone: normalizePhone(text(body.customer?.phone, 40)) ?? "",
    email: text(body.customer?.email, 200),
  }
  const delivery = body.delivery
  const fields = delivery?.method ? validateOrderFields(customer, delivery) : { delivery: "Оберіть спосіб доставки" }
  if (Object.keys(fields).length) {
    return NextResponse.json({ error: "Перевірте дані замовлення", fields }, { status: 400 })
  }
  if (!keycrmConfigured() || !redisConfigured()) {
    return NextResponse.json({ error: `Оформлення тимчасово недоступне. Зателефонуйте нам: ${SHOP_PHONE}, і ми приймемо замовлення.` }, { status: 503 })
  }

  const r = await redis()
  // Keeps bots from flooding KeyCRM with orders.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const attempts = await r.incr(`ratelimit:orders:${ip}`)
  if (attempts === 1) await r.expire(`ratelimit:orders:${ip}`, RATE_WINDOW)
  if (attempts > RATE_LIMIT) {
    return NextResponse.json(
      { error: `Забагато спроб оформлення. Спробуйте через 10 хвилин або зателефонуйте нам: ${SHOP_PHONE}.` },
      { status: 429 },
    )
  }

  // A repeated submit (double click, retry after a lost response) returns the order already placed.
  const previous = await r.get(ORDER_KEY(id))
  if (previous && previous !== "pending") return NextResponse.json({ order: JSON.parse(previous) })
  if (!(await r.set(ORDER_KEY(id), "pending", { NX: true, EX: 600 }))) {
    return NextResponse.json({ error: "Замовлення вже обробляється, зачекайте кілька секунд." }, { status: 409 })
  }

  try {
    const products = new Map((await readProducts(lines.map((l) => l.sku))).map((p) => [p.sku, p]))
    const changes: StockChange[] = []
    for (const line of lines) {
      const p = products.get(line.sku)
      if (!p || p.stock <= 0) {
        changes.push({ sku: line.sku, name: p?.name ?? line.sku, available: 0, unit: p?.priceUnit ?? "" })
      } else if (!isValidQuantity(p, line.quantity)) {
        changes.push({ sku: p.sku, name: p.name, available: p.stock, unit: p.priceUnit })
      }
    }
    if (changes.length) {
      await r.del(ORDER_KEY(id))
      return NextResponse.json({ error: "Поки ви оформлювали, змінилася наявність.", changes }, { status: 409 })
    }

    const orderItems = lines.map((l) => {
      const p = products.get(l.sku)!
      return { id: p.id, sku: p.sku, name: p.name, price: p.price, quantity: l.quantity, unit: p.priceUnit }
    })
    const subtotal = money(orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0))
    const method = effectivePaymentMethod(body.payment, delivery.method, subtotal)
    const split = paymentSplit(method, subtotal)
    const order: Order = {
      customer,
      items: orderItems,
      subtotal,
      total: subtotal,
      delivery,
      payment: { method, now: money(split.now), onReceipt: money(split.onReceipt) },
      notes: text(body.notes, 1000),
      createdAt: new Date().toISOString(),
    }

    const utm = Object.fromEntries(
      Object.entries(body.utm ?? {})
        .filter(([k]) => /^utm_(source|medium|campaign|term|content)$/.test(k))
        .map(([k, v]) => [k, text(v)]),
    )
    order.number = await createKeycrmOrder(order, id, utm)
    await r.set(ORDER_KEY(id), JSON.stringify(order), { EX: 86400 })

    // Test orders don't reserve anything in KeyCRM, so they leave the site's stock alone too.
    if (!isTestOrderEnvironment()) {
      await reserveStock(orderItems).catch((e) => console.error("[orders] stock update failed:", e.message))
      revalidatePath("/")
      for (const i of orderItems) revalidatePath(`/product/${i.sku}`)
    }
    console.log(`[orders] KeyCRM order ${order.number} (site ${id}), ${orderItems.length} items, ${order.total} ₴`)
    return NextResponse.json({ order })
  } catch (e) {
    await r.del(ORDER_KEY(id)).catch(() => {})
    console.error("[orders] failed:", (e as Error).message, (e as { body?: string }).body ?? "")
    return NextResponse.json(
      { error: `Не вдалося оформити замовлення. Спробуйте ще раз або зателефонуйте нам: ${SHOP_PHONE}.` },
      { status: 502 },
    )
  }
}
