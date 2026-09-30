import { type NextRequest, NextResponse } from "next/server"
import { cleanQuery } from "@/lib/nova-poshta"
import { field, upConfigured, upGet, type UpEntry } from "@/lib/ukrposhta"

const SHORT_TYPES: Record<string, string> = {
  місто: "м.",
  село: "с.",
  селище: "с-ще",
  "селище міського типу": "смт",
}

function withSuffix(value: string, suffix: string, known: RegExp): string {
  return !value || known.test(value) ? value : `${value} ${suffix}`
}

function toCity(e: UpEntry) {
  const title = field(e, "CITY_NAME", "CITY_UA")
  const type = field(e, "SHORTCITYTYPE_UA") || SHORT_TYPES[field(e, "CITYTYPE_NAME", "CITYTYPE_UA").toLowerCase()] || ""
  const region = field(e, "REGION_NAME", "REGION_UA")
  const district = field(e, "DISTRICT_NAME", "DISTRICT_UA")
  const name = [
    [type, title].filter(Boolean).join(" "),
    district !== title && withSuffix(district, "р-н", /р-н|район/i),
    region !== title && withSuffix(region, "обл.", /обл|^м\./i),
  ]
    .filter(Boolean)
    .join(", ")
  return {
    ref: field(e, "CITY_ID"),
    name,
    title,
    region,
    regionId: field(e, "REGION_ID"),
    district,
    districtId: field(e, "DISTRICT_ID"),
    population: Number(field(e, "POPULATION")) || 0,
  }
}

// Searches Ukrposhta settlements by name.
export async function POST(req: NextRequest) {
  if (!upConfigured()) return NextResponse.json({ configured: false, cities: [] })

  const { query } = await req.json().catch(() => ({}))
  const q = cleanQuery(query)
  if (q.length < 2) return NextResponse.json({ configured: true, cities: [] })

  try {
    // get_city_by_name returns region/district names, which tell same-named villages apart.
    // Fall back to the substring search if it finds nothing or is unavailable.
    let entries = await upGet("get_city_by_name", { city_name: q, lang: "UA", fuzzy: "0" }).catch(() => [])
    if (!entries.length) entries = await upGet("get_city_by_region_id_and_district_id_and_city_ua", { city_ua: q })

    const needle = q.toLowerCase()
    const rank = (title: string) => (title.toLowerCase() === needle ? 0 : title.toLowerCase().startsWith(needle) ? 1 : 2)
    const cities = entries
      .map(toCity)
      .filter((c) => c.ref && c.title)
      .sort((a, b) => rank(a.title) - rank(b.title) || b.population - a.population)
      .slice(0, 20)
      .map(({ population, ...c }) => c)
    return NextResponse.json({ configured: true, cities })
  } catch {
    return NextResponse.json({ configured: true, cities: [], error: "Помилка запиту до Укрпошти" }, { status: 502 })
  }
}
