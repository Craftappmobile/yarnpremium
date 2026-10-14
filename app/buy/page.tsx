import type { Metadata } from "next"
import { parseBuyItems } from "@/lib/buy-url"
import { BuyPage } from "./buy-page"

// /buy?i=<sku>:200,<sku>: several products into the cart at once (lib/buy-url.ts).
export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Покупка", robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams
  const i = typeof search.i === "string" ? search.i : ""
  return <BuyPage items={parseBuyItems(i)} search={search} />
}
