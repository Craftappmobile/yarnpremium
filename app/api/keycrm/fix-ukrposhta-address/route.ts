import { type NextRequest, NextResponse } from "next/server"
import { keycrmConfigured, keycrmGet, keycrmGetAll, keycrmSend } from "@/lib/keycrm"

// One-off: site orders sent to Ukrposhta before the classifier token was set
// reached KeyCRM with the office index typed into «Адреса» and «Поштовий
// індекс» empty. Moves the index to its field and puts the settlement in
// «Адреса», as managers fill them in. GET lists what would change;
// ?apply=<order id> fixes one order, ?apply=all every listed one. Orders with a
// waybill are left alone. Never available on production; to be removed once run.
export const dynamic = "force-dynamic"
export const maxDuration = 300

const SOURCE_ID = 8
const INDEX = /(?<!\d)\d{5}(?!\d)/

/** The shipping fields an order update may carry, so a PUT can't drop the rest. */
const SHIPPING_FIELDS = [
  "delivery_service_id",
  "warehouse_ref",
  "shipping_address_city",
  "shipping_address_country",
  "shipping_address_region",
  "shipping_address_zip",
  "shipping_secondary_line",
  "shipping_receive_point",
  "recipient_full_name",
  "recipient_phone",
] as const

type Shipping = Partial<Record<(typeof SHIPPING_FIELDS)[number] | "tracking_code", string | number | null>>
interface KeycrmOrder {
  id: number
  source_id?: number
  created_at?: string
  manager_comment?: string | null
  shipping?: Shipping | null
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === "production") return new NextResponse("Not found", { status: 404 })
  if (!keycrmConfigured()) return NextResponse.json({ error: "KEYCRM_API_KEY is not set" }, { status: 500 })

  const apply = req.nextUrl.searchParams.get("apply") ?? ""
  try {
    const orders = (
      await keycrmGetAll<KeycrmOrder>("/order", { "filter[source_id]": SOURCE_ID, include: "shipping" })
    ).filter((o) => o.source_id === SOURCE_ID && /Доставка: Укрпошта/.test(o.manager_comment ?? ""))

    const toFix: { id: number; created_at?: string; before: Shipping; after: Shipping }[] = []
    const withWaybill: number[] = []
    const noIndex: { id: number; address: string }[] = []
    let alreadyOk = 0

    for (const o of orders) {
      const s = o.shipping ?? {}
      const point = text(s.shipping_receive_point)
      const city = text(s.shipping_address_city)
      if (text(s.shipping_address_zip) && (!point || point === city)) {
        alreadyOk++
        continue
      }
      const index = text(s.shipping_address_zip) || point.match(INDEX)?.[0]
      if (!index) {
        noIndex.push({ id: o.id, address: point })
        continue
      }
      if (text(s.tracking_code)) {
        withWaybill.push(o.id)
        continue
      }
      const after: Shipping = {}
      for (const f of SHIPPING_FIELDS) if (s[f] !== null && s[f] !== undefined && s[f] !== "") after[f] = s[f]
      after.shipping_address_zip = index
      after.shipping_receive_point = city || point
      toFix.push({
        id: o.id,
        created_at: o.created_at,
        before: { shipping_receive_point: point, shipping_address_zip: text(s.shipping_address_zip), shipping_address_city: city },
        after,
      })
    }

    const targets = apply === "all" ? toFix : toFix.filter((o) => String(o.id) === apply)
    const applied: { id: number; ok: boolean; now?: Shipping; error?: string }[] = []
    for (const o of targets) {
      try {
        await keycrmSend("PUT", `/order/${o.id}`, { shipping: o.after })
        const now = await keycrmGet<KeycrmOrder>(`/order/${o.id}`, { include: "shipping" })
        const s = now.shipping ?? {}
        applied.push({
          id: o.id,
          ok: text(s.shipping_address_zip) === o.after.shipping_address_zip,
          now: {
            shipping_receive_point: s.shipping_receive_point,
            shipping_address_zip: s.shipping_address_zip,
            shipping_address_city: s.shipping_address_city,
            shipping_address_region: s.shipping_address_region,
            delivery_service_id: s.delivery_service_id,
          },
        })
      } catch (e) {
        applied.push({ id: o.id, ok: false, error: (e as Error).message })
      }
    }

    return NextResponse.json({
      ukrposhtaSiteOrders: orders.length,
      alreadyOk,
      toFix: toFix.map(({ id, created_at, before, after }) => ({
        id,
        created_at,
        before,
        after: { shipping_receive_point: after.shipping_receive_point, shipping_address_zip: after.shipping_address_zip },
      })),
      withWaybill,
      noIndex,
      applied,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
