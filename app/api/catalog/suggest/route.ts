import { type NextRequest, NextResponse } from "next/server"
import { readCatalog } from "@/lib/catalog"
import { similarProducts } from "@/lib/similar-products"

// Shades in stock close to a product, for the add-on offer on the order
// confirmation page. Products already ordered (`skip`) are left out.
export const dynamic = "force-dynamic"

const LIMIT = 8

export async function GET(req: NextRequest) {
  const sku = req.nextUrl.searchParams.get("sku")?.slice(0, 64)
  const skip = new Set(req.nextUrl.searchParams.getAll("skip").slice(0, 50))
  if (!sku) return NextResponse.json({ products: [] })
  const catalog = await readCatalog().catch(() => null)
  if (!catalog) return NextResponse.json({ products: [], error: "unavailable" }, { status: 503 })
  const product = catalog.find((p) => p.sku === sku)
  if (!product) return NextResponse.json({ products: [] })
  const products = similarProducts(product, catalog)
    .products.filter((p) => !skip.has(p.sku))
    .slice(0, LIMIT)
    .map(({ description: _description, specs: _specs, ...p }) => p)
  return NextResponse.json(
    { products },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
  )
}
