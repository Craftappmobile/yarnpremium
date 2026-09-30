import { type NextRequest, NextResponse } from "next/server"

const NP_URL = "https://api.novaposhta.ua/v2.0/json/"

// Returns Nova Poshta warehouses (відділення/поштомати) for a given settlement ref.
export async function POST(req: NextRequest) {
  const apiKey = process.env.NOVA_POSHTA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ configured: false, warehouses: [] })
  }

  const { cityRef, query } = await req.json()
  if (!cityRef || typeof cityRef !== "string") {
    return NextResponse.json({ configured: true, warehouses: [] })
  }

  try {
    const res = await fetch(NP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        modelName: "AddressGeneral",
        calledMethod: "getWarehouses",
        methodProperties: {
          SettlementRef: cityRef,
          FindByString: typeof query === "string" ? query : "",
          Limit: "50",
        },
      }),
    })
    const data = await res.json()
    const warehouses = (data?.data ?? []).map((w: any) => ({
      ref: w.Ref as string,
      description: w.Description as string,
    }))
    return NextResponse.json({ configured: true, warehouses })
  } catch {
    return NextResponse.json(
      { configured: true, warehouses: [], error: "Помилка запиту до Нової Пошти" },
      { status: 502 },
    )
  }
}
