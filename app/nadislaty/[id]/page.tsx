import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { orderMessage, sendTokenValid } from "@/lib/order-message"
import { SendOrder } from "@/components/admin/send-order"

// The manager's «📨 Надіслати клієнту» from a site order's comment in KeyCRM
// (lib/order-message.ts): the order as a message, and buttons that open the
// buyer's messenger with it.
export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Надіслати замовлення клієнту", robots: { index: false, follow: false } }

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ id: raw }, { t }] = await Promise.all([params, searchParams])
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0 || typeof t !== "string" || !sendTokenValid(id, t)) notFound()
  const message = await orderMessage(id)
  if (!message) {
    return (
      <main id="content" className="mx-auto max-w-xl px-4 py-8 text-sm">
        KeyCRM зараз не віддав замовлення №{id}. Оновіть сторінку за хвилину.
      </main>
    )
  }
  return (
    <main id="content" className="mx-auto max-w-xl px-4 py-8 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-xl font-semibold">Надіслати замовлення №{message.id}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {message.name || "Покупець"} · +{message.phone}
      </p>
      <SendOrder text={message.text} phone={message.phone} />
    </main>
  )
}
