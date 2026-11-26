import type { Metadata } from "next"
import { redirect } from "next/navigation"
import CampaignShop from "@/components/shop/campaign-shop"
import { packCatalog } from "@/components/shop/catalog-pack"
import { catalogPageData } from "@/lib/catalog-page"
import { CAMPAIGNS, campaignDays } from "@/lib/campaigns"
import { BRAND } from "@/lib/site"
import { openGraph } from "@/lib/og"

// The Black Friday page (lib/campaigns.ts): everything the sale's discount
// files cover. Rebuilt with the catalog, and when the sale starts or ends
// (app/api/cron/catalog-sync); outside its days it sends people to the catalog.
export const revalidate = 3600

const PATH = "/chorna-pyatnytsia"
const campaign = CAMPAIGNS.find((c) => c.path === PATH)!

export async function generateMetadata(): Promise<Metadata> {
  const title = `${campaign.name} в ${BRAND}: знижки на пряжу ${campaignDays(campaign)}`
  const description = `${campaign.name} в магазині пряжі ${BRAND}: ${campaignDays(campaign)}, знижка вже в цінах. Доставка по Україні, накладений платіж.`
  return {
    title,
    description,
    alternates: { canonical: PATH },
    openGraph: openGraph({ url: PATH, title, description }, { ownImage: true }),
  }
}

export default async function CampaignPage() {
  const { products, summary } = await catalogPageData("campaign")
  if (summary.campaign?.name !== campaign.name) redirect("/")
  const onSale = products.filter((p) => p.promo?.campaign === campaign.name)
  return (
    <main className="min-h-screen">
      <CampaignShop initial={packCatalog(onSale)} campaign={summary.campaign} />
    </main>
  )
}
