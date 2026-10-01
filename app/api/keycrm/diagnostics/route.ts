import { NextResponse } from "next/server"
import { keycrmConfigured, keycrmGet, keycrmGetAll, keycrmGetPages, keycrmKeyShape } from "@/lib/keycrm"

// Read-only snapshot of the KeyCRM catalog and order reference lists, used to
// plan the catalog import. The catalog is too large to read in one request under
// KeyCRM's rate limit, so lists are sampled (SAMPLE_PAGES pages each) and their
// totals reported. Never available on production.
export const dynamic = "force-dynamic"
export const maxDuration = 300

const SAMPLE_PAGES = 4

const count = (map: Record<string, number>, key: unknown) => {
  const k = key === null || key === undefined || key === "" ? "(порожньо)" : String(key)
  map[k] = (map[k] ?? 0) + 1
}

const trim = (o: any) =>
  o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v]))

export async function GET() {
  if (process.env.VERCEL_ENV === "production") return new NextResponse("Not found", { status: 404 })
  if (!keycrmConfigured()) return NextResponse.json({ error: "KEYCRM_API_KEY is not set" }, { status: 500 })

  const started = Date.now()
  try {
    const [categories, productsPage, offersPage, stocksPage] = await Promise.all([
      keycrmGetAll("/products/categories"),
      keycrmGetPages("/products", { include: "custom_fields" }, SAMPLE_PAGES),
      keycrmGetPages("/offers", { include: "product" }, SAMPLE_PAGES),
      keycrmGetPages("/offers/stocks", { "filter[details]": "true" }, SAMPLE_PAGES),
    ])
    const products = productsPage.items
    const offers = offersPage.items
    const stocks = stocksPage.items
    // Do the list filters we'd rely on for the import work? Compare totals.
    const filterProbes = await Promise.all(
      [
        ["/products", { "filter[is_archived]": "false" }],
        ["/products", { "filter[is_archived]": "true" }],
        ["/offers", { "filter[is_archived]": "false" }],
        ["/offers", { "filter[product_id]": products[0]?.id }],
        ["/offers/stocks", { "filter[offers_id]": offers.slice(0, 3).map((o: any) => o.id).join(",") }],
      ].map(async ([path, params]) => {
        try {
          const { total, items } = await keycrmGetPages(path as string, params as Record<string, string>, 1)
          return { path, params, total, firstPageCount: items.length }
        } catch (e) {
          return { path, params, error: (e as Error).message }
        }
      }),
    )
    const [sources, statuses, deliveryServices, paymentMethods, customFields] = await Promise.all([
      keycrmGet("/order/source", { limit: 50 }),
      keycrmGet("/order/status", { limit: 50 }),
      keycrmGet("/order/delivery-service", { limit: 50 }),
      keycrmGet("/order/payment-method", { limit: 50 }),
      keycrmGet("/custom-fields"),
    ])

    const categoryName = new Map(categories.map((c: any) => [c.id, c.name]))
    const productById = new Map(products.map((p: any) => [p.id, p]))
    const stockByOffer = new Map(stocks.map((s: any) => [s.id, s]))

    const unitTypes: Record<string, number> = {}
    const productCategories: Record<string, number> = {}
    const customFieldFill: Record<string, number> = {}
    const customFieldValues: Record<string, Set<string>> = {}
    let archived = 0
    let withOffers = 0
    let remoteThumbs = 0
    let withGallery = 0
    for (const p of products) {
      if (p.is_archived) archived++
      if (p.has_offers) withOffers++
      if (String(p.thumbnail_url ?? "").includes("/remote?url=")) remoteThumbs++
      if ((p.attachments_data ?? []).length > 1) withGallery++
      count(unitTypes, p.unit_type)
      count(productCategories, categoryName.get(p.category_id) ?? p.category_id)
      for (const cf of p.custom_fields ?? []) {
        const name = cf.name ?? cf.uuid
        if (cf.value === null || cf.value === undefined || cf.value === "") continue
        count(customFieldFill, name)
        const values = (customFieldValues[name] ??= new Set())
        if (values.size < 15) values.add(JSON.stringify(cf.value).slice(0, 80))
      }
    }

    const skuSeen: Record<string, number> = {}
    const offerProperties: Record<string, number> = {}
    for (const o of offers) {
      count(skuSeen, o.sku)
      for (const prop of o.properties ?? []) count(offerProperties, prop.name)
    }
    const duplicateSkus = Object.entries(skuSeen).filter(([sku, n]) => n > 1 && sku !== "(порожньо)")

    const warehouses: Record<string, number> = {}
    let withReserve = 0
    for (const s of stocks) {
      if ((s.reserve ?? 0) > 0) withReserve++
      for (const w of s.warehouse ?? []) count(warehouses, `${w.id}: ${w.name}`)
    }

    // What the site would show: offers of non-archived products with stock left after reserves.
    const sellable = offers.filter((o: any) => {
      const p = productById.get(o.product_id) ?? o.product
      const s = stockByOffer.get(o.id)
      const available = (s?.quantity ?? o.quantity ?? 0) - (s?.reserve ?? 0)
      return p && !p.is_archived && available > 0
    })
    const sellableByCategory: Record<string, number> = {}
    const sellableByUnit: Record<string, { count: number; minPrice: number; maxPrice: number }> = {}
    let cashmere = 0
    for (const o of sellable) {
      const p = productById.get(o.product_id) ?? o.product
      const cat = categoryName.get(p.category_id) ?? "(без категорії)"
      count(sellableByCategory, cat)
      const unit = p.unit_type ?? "шт (системні)"
      const u = (sellableByUnit[unit] ??= { count: 0, minPrice: Infinity, maxPrice: 0 })
      u.count++
      u.minPrice = Math.min(u.minPrice, o.price ?? 0)
      u.maxPrice = Math.max(u.maxPrice, o.price ?? 0)
      if (/кашемір|cashmere/i.test(`${p.name} ${cat}`)) cashmere++
    }

    const report = {
      tookSeconds: Math.round((Date.now() - started) / 1000),
      note: `Statistics below are from the first ${SAMPLE_PAGES} pages (${SAMPLE_PAGES * 50} items) of each list; *Total fields are whole-catalog counts.`,
      filterProbes,
      products: {
        listTotal: productsPage.total,
        sampled: products.length,
        archived,
        withOffers,
        unitTypes,
        byCategory: productCategories,
        thumbnailsViaRemoteProxy: remoteThumbs,
        withGallery,
        customFieldFill,
        customFieldSampleValues: Object.fromEntries(Object.entries(customFieldValues).map(([k, v]) => [k, [...v]])),
        sampleKeys: Object.keys(products[0] ?? {}),
        samples: products.slice(0, 2).map(trim),
      },
      offers: {
        listTotal: offersPage.total,
        sampled: offers.length,
        withoutSku: skuSeen["(порожньо)"] ?? 0,
        duplicateSkus: duplicateSkus.slice(0, 30),
        propertyNames: offerProperties,
        sampleKeys: Object.keys(offers[0] ?? {}),
        samples: offers.slice(0, 2).map(trim),
      },
      stocks: { listTotal: stocksPage.total, sampled: stocks.length, withReserve, warehouses, samples: stocks.slice(0, 2) },
      site: { sellableOffers: sellable.length, byCategory: sellableByCategory, byUnit: sellableByUnit, cashmere },
      categories: categories.map((c: any) => ({ id: c.id, name: c.name, parent_id: c.parent_id })),
      reference: {
        sources: (sources as any).data,
        statuses: (statuses as any).data,
        deliveryServices: (deliveryServices as any).data,
        paymentMethods: (paymentMethods as any).data,
        customFields: Array.isArray(customFields) ? customFields : ((customFields as any).data ?? customFields),
      },
    }
    // Also written to the runtime log (in chunks, log lines are size-limited) so it
    // can be read from Vercel without opening the protected preview.
    const text = JSON.stringify(report)
    const parts = Math.ceil(text.length / 3000)
    for (let i = 0; i < parts; i++) console.log(`[keycrm-diagnostics ${i + 1}/${parts}] ${text.slice(i * 3000, (i + 1) * 3000)}`)
    return NextResponse.json(report)
  } catch (e) {
    const error = (e as Error).message
    console.log(`[keycrm-diagnostics] ${error}`, keycrmKeyShape())
    return NextResponse.json({ error, key: keycrmKeyShape() }, { status: 502 })
  }
}
