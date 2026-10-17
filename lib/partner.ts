import { timingSafeEqual } from "node:crypto"

// Orders from the master-class site «Розрахуй і В'яжи» (yarnmk.com.ua): it sends the
// buyer's cart and delivery from its own checkout, the shop places the order as usual
// (KeyCRM, WayForPay, stock), and after paying the buyer goes back to that site.

export const PARTNER_SITE = "yarnmk.com.ua"

/** `ref`: the order's id on the master-class site; `returnUrl`: where the buyer lands after paying. */
export interface PartnerOrder {
  site: string
  ref: string
  returnUrl: string
}

/** The master-class site's server signs its calls with the shared MK_PARTNER_SECRET. */
export function partnerAuthorized(authorization: string | null): boolean {
  const secret = process.env.MK_PARTNER_SECRET ?? ""
  if (secret.length < 24) return false
  const got = Buffer.from((authorization ?? "").replace(/^Bearer\s+/i, ""))
  const want = Buffer.from(secret)
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Only addresses on the master-class site are allowed as the return page. */
export function partnerReturnUrl(raw: unknown): string | null {
  const allowed = (process.env.MK_PARTNER_RETURN_ORIGINS ?? "https://yarnmk.com.ua")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
  try {
    const url = new URL(String(raw))
    return allowed.includes(url.origin) ? url.toString() : null
  } catch {
    return null
  }
}
