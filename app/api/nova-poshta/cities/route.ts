import { type NextRequest, NextResponse } from "next/server"
import { npCall, npConfigured, cleanQuery } from "@/lib/nova-poshta"

// Searches Nova Poshta settlements by name.
export async function POST(req: NextRequest) {
  if (!npConfigured()) return NextResponse.json({ configured: false, cities: [] })

  const { query } = await req.json().catch(() => ({}))
  const q = cleanQuery(query)
  if (q.length < 2) return NextResponse.json({ configured: true, cities: [] })

  try {
    const data = await npCall("AddressGeneral", "searchSettlements", { CityName: q, Limit: "20", Page: "1" })
    const addresses: any[] = data[0]?.Addresses ?? []
    const cities = addresses
      // Settlements without a DeliveryCity have no Nova Poshta service.
      .filter((a) => a.DeliveryCity)
      .map((a) => ({
        ref: a.DeliveryCity as string,
        settlementRef: a.Ref as string,
        name: a.Present as string,
      }))
    return NextResponse.json({ configured: true, cities })
  } catch (err) {
    console.error("[nova-poshta] searchSettlements failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ configured: true, cities: [], error: "Помилка запиту до Нової Пошти" }, { status: 502 })
  }
}
