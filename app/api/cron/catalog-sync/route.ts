import { type NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { syncCatalog } from "@/lib/catalog"
import { keycrmConfigured } from "@/lib/keycrm"
import { redisConfigured } from "@/lib/redis"

// Copies the KeyCRM catalog into Redis. Run by Vercel Cron (vercel.json); on
// preview deployments it can be opened by hand, with ?force to skip the
// minimum interval.
export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Repeated calls (e.g. someone hitting the URL) never reach KeyCRM more often than this. */
const MIN_INTERVAL_MS = 5 * 60_000
/** More changed products than this rebuild every product page instead of listing them. */
const MAX_PRODUCT_PATHS = 100

/**
 * Marks the pages showing what the sync changed for rebuilding on their next
 * visit. Pages that don't show the catalog (about, delivery, blog) stay cached.
 */
function revalidateChanged(skus: string[], everything: boolean) {
  if (!everything && skus.length === 0) return
  revalidatePath("/")
  revalidatePath("/kategoriya/[slug]", "page")
  if (everything || skus.length > MAX_PRODUCT_PATHS) revalidatePath("/product/[sku]", "page")
  else for (const sku of skus) revalidatePath(`/product/${sku}`)
}

export async function GET(req: NextRequest) {
  // Vercel Cron sends CRON_SECRET as a bearer token when the variable is set.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!keycrmConfigured() || !redisConfigured()) {
    return NextResponse.json({ error: "KEYCRM_API_KEY or REDIS_URL is not set" }, { status: 500 })
  }

  const force = process.env.VERCEL_ENV !== "production" && req.nextUrl.searchParams.has("force")
  try {
    const { changedSkus = [], ...report } = await syncCatalog({ minIntervalMs: force ? 0 : MIN_INTERVAL_MS })
    // A promotion starting or ending changes prices on every product page.
    if (report.ran) revalidateChanged(changedSkus, Boolean(report.promosChanged))
    console.log("[catalog-sync]", JSON.stringify({ ...report, changedSkus: changedSkus.slice(0, 20) }))
    return NextResponse.json(report)
  } catch (e) {
    console.error("[catalog-sync] failed:", (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
