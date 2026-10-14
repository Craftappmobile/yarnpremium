import type { Metadata } from "next"
import { BuyPage } from "../buy-page"

// /buy/<sku>[?q=200]: the product into the cart, then checkout (lib/buy-url.ts).
export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Покупка", robots: { index: false } }

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ sku }, search] = await Promise.all([params, searchParams])
  const q = Number(search.q)
  return <BuyPage items={[{ sku: decodeURIComponent(sku), quantity: q > 0 ? q : undefined }]} search={search} />
}
