import { SITE_URL } from "@/lib/site"

// Links that put yarn straight into the cart and open checkout (app/buy):
//   /buy/<sku>                 the product's minimum (100 г, cashmere 50 г)
//   /buy/<sku>?q=200           that amount
//   /buy?i=<sku>:200,<sku>     several products at once (a kit, a manager's reply)
// The utm_* tags of the link reach the order in KeyCRM, as from an ad.

export type Utm = Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content", string>>

const query = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString()
  return q ? `?${q}` : ""
}

export function buyUrl(sku: string, utm: Utm = {}, quantity?: number): string {
  return `${SITE_URL}/buy/${encodeURIComponent(sku)}${query({ q: quantity ? String(quantity) : undefined, ...utm })}`
}

export function buyManyUrl(items: { sku: string; quantity?: number }[], utm: Utm = {}): string {
  const i = items.map(({ sku, quantity }) => (quantity ? `${sku}:${quantity}` : sku)).join(",")
  return `${SITE_URL}/buy${query({ i, ...utm })}`
}

/** «sku:200,sku» → items; quantities that aren't positive numbers are left to the product's minimum. */
export function parseBuyItems(i: string): { sku: string; quantity?: number }[] {
  return i
    .split(",")
    .map((part) => {
      const at = part.lastIndexOf(":")
      const sku = (at === -1 ? part : part.slice(0, at)).trim()
      const q = at === -1 ? NaN : Number(part.slice(at + 1))
      return { sku, quantity: Number.isFinite(q) && q > 0 ? q : undefined }
    })
    .filter((item) => item.sku && item.sku.length <= 64)
    .slice(0, 30)
}
