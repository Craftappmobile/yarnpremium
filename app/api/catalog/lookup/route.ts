import { type NextRequest, NextResponse } from "next/server"
import { readProducts } from "@/lib/catalog"

// Current price and stock for the products in a saved cart or wishlist.
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const { skus } = await req.json().catch(() => ({}))
  const list = Array.isArray(skus)
    ? [...new Set(skus.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 64))].slice(0, 200)
    : []
  try {
    return NextResponse.json({ products: await readProducts(list) })
  } catch {
    return NextResponse.json({ products: [], error: "Каталог тимчасово недоступний" }, { status: 503 })
  }
}
