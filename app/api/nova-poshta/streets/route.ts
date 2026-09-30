import { type NextRequest, NextResponse } from "next/server"
import { npCall, npConfigured, cleanQuery } from "@/lib/nova-poshta"

// Searches streets within a settlement for courier delivery.
export async function POST(req: NextRequest) {
  if (!npConfigured()) return NextResponse.json({ configured: false, streets: [] })

  const { settlementRef, query } = await req.json().catch(() => ({}))
  const ref = cleanQuery(settlementRef, 64)
  const q = cleanQuery(query)
  if (!ref || q.length < 2) return NextResponse.json({ configured: true, streets: [] })

  try {
    const data = await npCall("AddressGeneral", "searchSettlementStreets", {
      SettlementRef: ref,
      StreetName: q,
      Limit: "20",
    })
    const addresses: any[] = data[0]?.Addresses ?? []
    const streets = addresses.map((a) => ({ ref: a.SettlementStreetRef as string, name: a.Present as string }))
    return NextResponse.json({ configured: true, streets })
  } catch {
    return NextResponse.json({ configured: true, streets: [], error: "Помилка запиту до Нової Пошти" }, { status: 502 })
  }
}
