import type { NextRequest } from "next/server"
import { placeOrder } from "@/lib/place-order"
import type { OrderRequest } from "@/lib/order"

// The shop's checkout. The order itself is placed in lib/place-order.ts.
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  return placeOrder(req, (await req.json().catch(() => null)) as OrderRequest | null)
}
