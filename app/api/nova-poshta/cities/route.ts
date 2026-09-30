import { type NextRequest, NextResponse } from "next/server"

const NP_URL = "https://api.novaposhta.ua/v2.0/json/"

// Searches Nova Poshta settlements by name. The API key is read server-side and
// never exposed to the client.
export async function POST(req: NextRequest) {
  const apiKey = process.env.NOVA_POSHTA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ configured: false, cities: [] })
  }

  const { query } = await req.json()
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return NextResponse.json({ configured: true, cities: [] })
  }

  try {
    const res = await fetch(NP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        modelName: "AddressGeneral",
        calledMethod: "searchSettlements",
        methodProperties: { CityName: query.trim(), Limit: "20" },
      }),
    })
    const data = await res.json()
    const addresses = data?.data?.[0]?.Addresses ?? []
    const cities = addresses.map((a: any) => ({
      ref: a.DeliveryCity as string,
      name: a.Present as string,
      mainDescription: a.MainDescription as string,
    }))
    return NextResponse.json({ configured: true, cities })
  } catch {
    return NextResponse.json({ configured: true, cities: [], error: "Помилка запиту до Нової Пошти" }, { status: 502 })
  }
}
