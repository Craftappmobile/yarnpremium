import { type NextRequest, NextResponse } from "next/server"
import { cleanQuery } from "@/lib/nova-poshta"
import { field, upConfigured, upGet, type UpEntry } from "@/lib/ukrposhta"

function toOffice(e: UpEntry) {
  const postcode = field(e, "POSTINDEX", "POSTCODE")
  const address =
    field(e, "ADDRESS") || [field(e, "STREETTYPE_UA"), field(e, "STREET_UA"), field(e, "HOUSENUMBER")].filter(Boolean).join(" ")
  const lockCode = Number(field(e, "LOCK_CODE")) || 0
  const lockReason = lockCode ? field(e, "LOCK_UA", "POLOCK_UA") || "тимчасово не працює" : ""
  return {
    ref: field(e, "ID"),
    postcode,
    description: [`№${postcode}`, address].filter(Boolean).join(" — ") + (lockReason ? ` (${lockReason})` : ""),
    locked: lockCode !== 0,
  }
}

// Returns Ukrposhta offices for a settlement (classifier CITY_ID).
export async function POST(req: NextRequest) {
  if (!upConfigured()) return NextResponse.json({ configured: false, offices: [] })

  const { cityId, query } = await req.json().catch(() => ({}))
  const id = cleanQuery(cityId, 20)
  if (!/^\d+$/.test(id)) return NextResponse.json({ configured: true, offices: [] })

  try {
    let entries = await upGet("get_postoffices_by_city_id", { city_id: id })
    // Villages without their own office are served by one in a neighbouring settlement.
    if (!entries.length) entries = await upGet("get_postoffices_by_postindex", { pdCityId: id })

    const q = cleanQuery(query).toLowerCase()
    const seen = new Set<string>()
    const offices = entries
      .map(toOffice)
      .filter((o) => o.ref && o.postcode && !seen.has(o.ref) && seen.add(o.ref))
      .filter((o) => !q || o.description.toLowerCase().includes(q))
      // Working offices first, then by index.
      .sort((a, b) => Number(a.locked) - Number(b.locked) || a.postcode.localeCompare(b.postcode))
      .slice(0, 50)
      .map(({ locked, ...o }) => o)
    return NextResponse.json({ configured: true, offices })
  } catch {
    return NextResponse.json({ configured: true, offices: [], error: "Помилка запиту до Укрпошти" }, { status: 502 })
  }
}
