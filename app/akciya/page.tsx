import { redirect } from "next/navigation"
import { PROMOS, activePromo } from "@/lib/promo"
import { categoryPath } from "@/lib/category-url"

// Short address for ads, the Instagram bio and mailings: the category of the
// promotion running now, or the catalog when none is.
export const dynamic = "force-dynamic"

export default function Akciya() {
  const promo = PROMOS.find((p) => activePromo(p.category) === p)
  redirect(promo ? categoryPath(promo.category) : "/")
}
