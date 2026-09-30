import { type NextRequest, NextResponse } from "next/server"
import { npCall, npConfigured, cleanQuery } from "@/lib/nova-poshta"

// Returns Nova Poshta branches or postomats for a city (DeliveryCity ref).
export async function POST(req: NextRequest) {
  if (!npConfigured()) return NextResponse.json({ configured: false, warehouses: [] })

  const { cityRef, query, kind } = await req.json().catch(() => ({}))
  const ref = cleanQuery(cityRef, 64)
  if (!ref) return NextResponse.json({ configured: true, warehouses: [] })
  const wantPostomat = kind === "postomat"

  try {
    const data = await npCall("AddressGeneral", "getWarehouses", {
      CityRef: ref,
      FindByString: cleanQuery(query),
      Limit: "500",
      Page: "1",
    })
    const warehouses = data
      .filter((w: any) => (w.CategoryOfWarehouse === "Postomat") === wantPostomat)
      .slice(0, 50)
      .map((w: any) => ({ ref: w.Ref as string, description: w.Description as string }))
    return NextResponse.json({ configured: true, warehouses })
  } catch {
    return NextResponse.json(
      { configured: true, warehouses: [], error: "Помилка запиту до Нової Пошти" },
      { status: 502 },
    )
  }
}
