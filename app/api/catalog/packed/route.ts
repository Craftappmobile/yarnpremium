import { NextResponse } from "next/server"
import { readCatalog } from "@/lib/catalog"
import { packCatalog } from "@/components/shop/catalog-pack"

// The whole in-stock catalog for the catalog page's search and filters. The
// page ships only its first screen of products and loads this right after,
// so the first view isn't held up by a few hundred kilobytes of data.
export const dynamic = "force-dynamic"

export async function GET() {
  const catalog = await readCatalog().catch((e) => {
    console.error("[catalog] unavailable:", (e as Error).message)
    return null
  })
  if (!catalog) return NextResponse.json({ error: "unavailable" }, { status: 503 })
  return NextResponse.json(packCatalog(catalog.filter((p) => p.stock > 0)), {
    // Shared by every visitor through Vercel's CDN; stock is refreshed by the
    // catalog sync anyway and re-checked at checkout.
    headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" },
  })
}
