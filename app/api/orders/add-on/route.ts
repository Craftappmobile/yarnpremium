import { type NextRequest, NextResponse, after } from "next/server"
import { revalidatePath } from "next/cache"
import { readProducts, reserveStock } from "@/lib/catalog"
import { createKeycrmOrder, isTestOrderEnvironment } from "@/lib/keycrm-order"
import { countStats } from "@/lib/assistant/stats"
import { buyerContext, sendOrderPlaced } from "@/lib/meta-capi"
import { keycrmConfigured } from "@/lib/keycrm"
import { redis, redisConfigured } from "@/lib/redis"
import { SHOP_PHONE } from "@/lib/site"
import { createPayment } from "@/lib/wayforpay"
import { ADD_ON, priceAddOn } from "@/components/shop/data"
import { readLines, stockChanges, toOrderItems } from "@/lib/order-lines"
import { addOnPayment, type AddOnRequest, type Order } from "@/lib/order"

// Adds to an order just placed (ADD_ON): within ADD_ON.minutes of it, once
// it's paid, one add-on per order at the add-on discount. It goes to KeyCRM as
// its own order marked for the manager to send in the same parcel.
export const dynamic = "force-dynamic"
export const maxDuration = 60

const ORDER_KEY = (id: string) => `order:${id}`
/** The add-on of an order: "pending" while it is being placed, then its site id. */
const ADD_ON_KEY = (id: string) => `order:${id}:add-on`
/** A request sent just before the offer ran out still counts. */
const GRACE_MS = 2 * 60_000
const RATE_LIMIT = 10
const RATE_WINDOW = 600
const money = (n: number) => Math.round(n * 100) / 100
const fail = (error: string, status: number, extra: object = {}) => NextResponse.json({ error, ...extra }, { status })

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as AddOnRequest | null
  const mainId = typeof body?.order === "string" ? body.order : ""
  const lines = readLines(body?.items)
  if (!/^[\w-]{8,60}$/.test(mainId) || !lines) return fail("Не вдалося додати товари. Оновіть сторінку і спробуйте ще раз.", 400)
  if (!keycrmConfigured() || !redisConfigured()) {
    return fail(`Додати товари зараз не вдається. Зателефонуйте нам: ${SHOP_PHONE}, і ми додамо їх до замовлення.`, 503)
  }

  const r = await redis()
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const attempts = await r.incr(`ratelimit:orders:${ip}`)
  if (attempts === 1) await r.expire(`ratelimit:orders:${ip}`, RATE_WINDOW)
  if (attempts > RATE_LIMIT) return fail(`Забагато спроб. Спробуйте через 10 хвилин або зателефонуйте нам: ${SHOP_PHONE}.`, 429)

  const raw = await r.get(ORDER_KEY(mainId))
  const main = raw && raw !== "pending" ? (JSON.parse(raw) as Order) : null
  if (!main?.number || main.addOnTo) return fail("Не вдалося знайти замовлення.", 404)
  if (Date.now() - Date.parse(main.createdAt) > ADD_ON.minutes * 60_000 + GRACE_MS) {
    return fail(`Час, щоб додати до замовлення, минув. Зателефонуйте нам: ${SHOP_PHONE} — підкажемо, чи ще встигаємо.`, 410)
  }
  if (main.payment.now > 0 && !main.payment.paid) return fail("Спершу оплатіть замовлення.", 409)

  // One add-on per order; a repeated submit returns the one already placed.
  const addOnId = `${mainId}-add`
  const placed = await r.get(ADD_ON_KEY(mainId))
  if (placed && placed !== "pending") {
    const previous = await r.get(ORDER_KEY(placed))
    if (previous) return NextResponse.json({ id: placed, order: JSON.parse(previous) })
  }
  if (!(await r.set(ADD_ON_KEY(mainId), "pending", { NX: true, EX: 600 }))) {
    return fail("Доповнення вже обробляється, зачекайте кілька секунд.", 409)
  }

  try {
    const products = new Map((await readProducts(lines.map((l) => l.sku))).map((p) => [p.sku, p]))
    const changes = stockChanges(lines, products)
    if (changes.length) {
      await r.del(ADD_ON_KEY(mainId))
      return fail("Поки ви обирали, змінилася наявність.", 409, { changes })
    }

    const priced = priceAddOn(
      lines.map((l) => ({ product: products.get(l.sku)!, quantity: l.quantity })),
      main.total,
    )
    const items = toOrderItems(lines, products, priced)
    const subtotal = money(items.reduce((sum, i) => sum + i.total, 0))
    const order: Order = {
      customer: main.customer,
      items,
      subtotal,
      total: subtotal,
      delivery: main.delivery,
      payment: addOnPayment(main.payment.method, subtotal),
      notes: "",
      addOnTo: { id: mainId, number: main.number },
      createdAt: new Date().toISOString(),
    }
    order.number = await createKeycrmOrder(order, addOnId)
    await r.set(ORDER_KEY(addOnId), JSON.stringify(order), { EX: 86400 })
    await r.set(ADD_ON_KEY(mainId), addOnId, { EX: 86400 })
    const ctx = buyerContext(req)
    after(() => sendOrderPlaced(order, addOnId, ctx))

    if (!isTestOrderEnvironment()) {
      await countStats({
        orders_add_on: 1,
        revenue_add_on: order.total,
        discount_add_on: money(priced.reduce((sum, l) => sum + (l.addOn ? l.saved : 0), 0)),
      })
      await reserveStock(items).catch((e) => console.error("[add-on] stock update failed:", e.message))
      revalidatePath("/")
      revalidatePath("/kategoriya/[slug]", "page")
      for (const i of items) revalidatePath(`/product/${i.sku}`)
    }
    console.log(`[add-on] KeyCRM order ${order.number} added to ${main.number} (site ${mainId}), ${items.length} items, ${order.total} ₴`)
    const payment =
      order.payment.now > 0
        ? await createPayment(order, addOnId, new URL(req.url).origin).catch((e) => {
            console.error("[add-on] payment form failed:", (e as Error).message)
            return null
          })
        : null
    return NextResponse.json({ id: addOnId, order, payment })
  } catch (e) {
    await r.del(ADD_ON_KEY(mainId)).catch(() => {})
    console.error("[add-on] failed:", (e as Error).message, (e as { body?: string }).body ?? "")
    return fail(`Не вдалося додати товари. Спробуйте ще раз або зателефонуйте нам: ${SHOP_PHONE}.`, 502)
  }
}
