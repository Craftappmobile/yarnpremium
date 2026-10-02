import { NextResponse } from "next/server"
import { redis, redisConfigured } from "@/lib/redis"
import { createPayment } from "@/lib/wayforpay"
import { SHOP_PHONE } from "@/lib/site"
import type { Order } from "@/lib/order"

// A new payment attempt for an order placed earlier whose online part isn't
// paid yet (the buyer closed the payment page or the card was declined).
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === "string" ? body.id : ""
  if (!/^[\w-]{8,64}$/.test(id) || !redisConfigured()) {
    return NextResponse.json({ error: "Замовлення не знайдено." }, { status: 400 })
  }
  const raw = await (await redis()).get(`order:${id}`)
  if (!raw || raw === "pending") {
    return NextResponse.json(
      { error: `Не вдалося знайти замовлення для оплати. Зателефонуйте нам: ${SHOP_PHONE}, і ми надішлемо посилання.` },
      { status: 404 },
    )
  }
  const order = JSON.parse(raw) as Order
  if (order.payment.paid) return NextResponse.json({ paid: true })
  if (!order.number || order.payment.now <= 0) return NextResponse.json({ error: "Це замовлення не потребує онлайн-оплати." }, { status: 400 })
  return NextResponse.json({ payment: await createPayment(order, id, new URL(req.url).origin) })
}
