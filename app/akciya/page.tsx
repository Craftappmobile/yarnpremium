import { redirect } from "next/navigation"
import { PROMOS, isRunning, promoPath } from "@/lib/promo"
import { runningCampaign } from "@/lib/campaigns"

// Short address for ads, the Instagram bio and mailings: the page of the sale
// running now, else the category of the promotion running now, else the catalog.
export const dynamic = "force-dynamic"

export default function Akciya() {
  const campaign = runningCampaign()
  if (campaign) redirect(campaign.path)
  const promo = PROMOS.find((p) => isRunning(p))
  redirect(promo ? promoPath(promo) : "/")
}
