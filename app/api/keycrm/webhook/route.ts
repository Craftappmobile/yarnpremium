import { type NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { applyStockUpdates, type StockUpdate } from "@/lib/catalog"
import { webhookAuthorized as authorized } from "@/lib/keycrm"

// Receives KeyCRM's stock webhook, so a sale anywhere (Instagram, the shop, the
// site) shows on the site within seconds instead of at the next 15-minute sync.
// KeyCRM doesn't sign webhooks: the URL carries a secret, ?token=KEYCRM_WEBHOOK_SECRET.
export const dynamic = "force-dynamic"

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v))

/**
 * Finds stock records anywhere in the payload: objects naming an offer (sku or
 * offer_id) with a stock figure. Nested objects inside a record (per-warehouse
 * rows) are not read on their own, so totals aren't mixed with partial counts.
 */
function stockRecords(payload: unknown, depth = 0): StockUpdate[] {
  if (depth > 5 || payload === null || typeof payload !== "object") return []
  if (Array.isArray(payload)) return payload.flatMap((p) => stockRecords(p, depth + 1))
  const o = payload as Record<string, unknown>
  const sku = typeof o.sku === "string" && o.sku.trim() ? o.sku.trim() : undefined
  const offerId = num(o.offer_id ?? (sku ? o.id : undefined))
  const inStock = num(o.in_stock ?? o.quantity)
  if ((sku || Number.isFinite(offerId)) && Number.isFinite(inStock)) {
    const inReserve = num(o.in_reserve ?? o.reserve)
    return [
      {
        sku,
        offerId: Number.isFinite(offerId) ? offerId : undefined,
        inStock,
        inReserve: Number.isFinite(inReserve) ? inReserve : 0,
      },
    ]
  }
  return Object.values(o).flatMap((v) => stockRecords(v, depth + 1))
}

// Lets you check the URL in a browser: "ok" means the token is right.
export async function GET(req: NextRequest) {
  return authorized(req) ? new NextResponse("ok") : new NextResponse("Unauthorized", { status: 401 })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const raw = await req.text()
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    console.warn("[keycrm-webhook] not JSON:", raw.slice(0, 500))
    return NextResponse.json({ ok: true, updated: 0 })
  }

  const records = stockRecords(payload)
  if (records.length === 0) {
    // Answer 200 anyway so KeyCRM doesn't keep retrying; the log shows what arrived.
    console.warn("[keycrm-webhook] no stock records in:", raw.slice(0, 1000))
    return NextResponse.json({ ok: true, updated: 0 })
  }

  try {
    const updated = await applyStockUpdates(records)
    if (updated.length) {
      revalidatePath("/")
      for (const sku of updated) revalidatePath(`/product/${sku}`)
    }
    console.log(`[keycrm-webhook] ${records.length} records, updated: ${updated.join(", ") || "none"}`, raw.slice(0, 300))
    return NextResponse.json({ ok: true, updated: updated.length })
  } catch (e) {
    console.error("[keycrm-webhook] failed:", (e as Error).message)
    // 5xx so KeyCRM tries again later.
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 })
  }
}
