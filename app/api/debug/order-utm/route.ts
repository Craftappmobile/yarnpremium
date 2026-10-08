import { type NextRequest, NextResponse } from "next/server"
import { keycrmGet, keycrmGetAll, keycrmGetPages } from "@/lib/keycrm"

// TEMPORARY, preview deployments only: which KeyCRM orders of the last days
// carry ad UTM tags, by source. No names, phones or addresses in the answer.
export const dynamic = "force-dynamic"
export const maxDuration = 120

const pick = (o: any, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => o?.[k] !== undefined && o?.[k] !== null && o?.[k] !== "").map((k) => [k, o[k]]))

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse("Not found", { status: 404 })
  const ids = req.nextUrl.searchParams.get("ids")
  if (ids) {
    const one = await Promise.all(
      ids.split(",").map((id) =>
        keycrmGet<any>(`/order/${id}`, { include: "marketing,tags" })
          .then((o) => ({ id: o.id, created_at: o.created_at, source_id: o.source_id, status_id: o.status_id, payment_status: o.payment_status, total: o.grand_total, parent_id: o.parent_id, utm: pick(o.marketing, ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]), tags: (o.tags ?? []).map((t: any) => t.name) }))
          .catch((e) => ({ id, error: (e as Error).message })),
      ),
    )
    return NextResponse.json(one)
  }
  const from = req.nextUrl.searchParams.get("from") ?? "2026-09-30"
  const to = req.nextUrl.searchParams.get("to") ?? "2026-10-09"
  const [sources, statuses, { items, total }] = await Promise.all([
    keycrmGetAll<any>("/order/source").catch(() => []),
    keycrmGetAll<any>("/order/status").catch(() => []),
    keycrmGetPages<any>(
      "/order",
      { include: "marketing,tags,custom_fields", "filter[created_between]": `${from},${to}` },
      30,
    ),
  ])
  const sourceName = new Map(sources.map((s) => [s.id, s.name ?? s.alias]))
  const statusName = new Map(statuses.map((s) => [s.id, s.name ?? s.alias]))

  const orders = items.map((o) => ({
    id: o.id,
    created_at: o.created_at,
    source: sourceName.get(o.source_id) ?? o.source_id,
    status: statusName.get(o.status_id) ?? o.status_id,
    payment_status: o.payment_status,
    total: o.grand_total,
    utm: pick(o.marketing, ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]),
    marketing_keys: o.marketing ? Object.keys(o.marketing) : [],
    tags: (o.tags ?? []).map((t: any) => t.name),
    custom_fields: (o.custom_fields ?? []).map((f: any) => ({ name: f.name, uuid: f.uuid, value: f.value })),
  }))
  return NextResponse.json({ from, to, read: items.length, total, orders })
}
