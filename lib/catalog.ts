// Server-only catalog: a snapshot of the KeyCRM catalog kept in Redis.
//
// KeyCRM is the source of truth. `syncCatalog()` (run by the cron route) reads
// every non-archived offer from KeyCRM and replaces the snapshot; pages read the
// snapshot, never KeyCRM itself, because a full read takes a couple of minutes
// under KeyCRM's 60 requests/minute limit.
//
// Redis keys:
//   catalog:products   hash  sku -> Product JSON (stock as of the last sync)
//   catalog:stock      hash  sku -> available quantity (live; stock webhooks update it)
//   catalog:stock_at   hash  sku -> ms timestamp of the last webhook stock update
//   catalog:offer_sku  hash  KeyCRM offer id -> sku (webhooks may name offers by id only)
//   catalog:image_color hash photo URL -> yarn colour worked out from it (kept across syncs)
//   catalog:meta       JSON  report of the last sync
//   catalog:lock       lock  held while a sync runs

import type { Product } from "@/components/shop/data"
import type { YarnColor } from "@/lib/image-color"
import { familyFromName } from "@/components/shop/yarn-colors"
import { keycrmGetAll, keycrmGetPages } from "@/lib/keycrm"
import { redis, redisConfigured } from "@/lib/redis"

const KEY_PRODUCTS = "catalog:products"
const KEY_STOCK = "catalog:stock"
const KEY_STOCK_AT = "catalog:stock_at"
const KEY_OFFER_SKU = "catalog:offer_sku"
const KEY_META = "catalog:meta"
const KEY_LOCK = "catalog:lock"
const KEY_IMAGE_COLOR = "catalog:image_color"

/** Photo colours are worked out after KeyCRM is read, until this long after the sync started. */
const COLOR_DEADLINE_MS = 200_000
const COLOR_CONCURRENCY = 8
/** A photo that couldn't be read is tried again after a day. */
const COLOR_RETRY_MS = 24 * 3600_000
/** Names and categories that mean a multicoloured yarn, whatever the photo shows. */
const MULTI_NAME = /мульти|секційн|принт|омбре|градієнт|шкарпетков/i

/** KeyCRM categories that are not sold on the site (compared case-insensitively). */
const EXCLUDED_CATEGORIES = ["стікери", "палітри", "подарунковий сертифікат", "спиці", "засоби для прання"]
const SALE_CATEGORY = "акційний товар"
/** Grams: the minimum is 100 g (50 g for cashmere), then ±50 g. */
const GRAM_MIN = 100
const CASHMERE_GRAM_MIN = 50
const GRAM_STEP = 50
const DESCRIPTION_MAX = 1000

/** Cashmere is sold from 50 g: its category says so, or for sale items its name starts with it. */
function isCashmere(name: string, category: string): boolean {
  const cat = category.toLowerCase()
  if (cat.includes("кашемір")) return true
  const n = name.trim().toLowerCase()
  return cat === SALE_CATEGORY && (n.startsWith("кашемір") || n.includes("кашемір шовк"))
}

/** KeyCRM sometimes serves images through a "/remote?url=" proxy; use the original URL. */
function imageUrl(url: unknown): string {
  if (typeof url !== "string" || !url) return ""
  const i = url.indexOf("/remote?url=")
  if (i === -1) return url
  return decodeURIComponent(url.slice(i + "/remote?url=".length).split("&")[0])
}

function customFields(product: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const cf of product?.custom_fields ?? []) {
    const value = Array.isArray(cf.value) ? cf.value.join(", ") : cf.value
    if (cf.name && value !== null && value !== undefined && String(value).trim()) out[cf.name] = String(value).trim()
  }
  return out
}

function toProduct(offer: any, product: any, fields: Record<string, string>, category: string): Product {
  const name = String(product.name ?? "").trim()
  const unit = String(product.unit_type ?? "").trim() || "шт"
  const images = [offer.thumbnail_url, product.thumbnail_url, ...(product.attachments_data ?? [])]
    .map(imageUrl)
    .filter((u, i, all) => u && all.indexOf(u) === i)
  return {
    id: offer.sku,
    offerId: offer.id,
    name,
    description: String(product.description ?? "").trim().slice(0, DESCRIPTION_MAX),
    price: Number(offer.price ?? product.price ?? 0),
    priceUnit: unit,
    image: images[0] ?? "",
    images: images.slice(0, 6),
    category,
    sku: offer.sku,
    // quantity is the total over all warehouses; in_reserve is held by open orders.
    stock: Math.max(0, Math.floor(Number(offer.quantity ?? 0) - Number(offer.in_reserve ?? 0))),
    color: fields["Колір"] ?? "",
    length: Number.parseInt(fields["Метраж"] ?? "", 10) || 0,
    brand: fields["Виробник"] ?? "",
    article: fields["Артикул"] ?? "",
    ...quantityLimits(name, category, unit),
  }
}

/** Minimum and step, from the selling rules in this file. */
function quantityLimits(name: string, category: string, unit: string): Pick<Product, "minQty" | "step"> {
  if (unit !== "г") return { minQty: 1, step: 1 }
  return { minQty: isCashmere(name, category) ? CASHMERE_GRAM_MIN : GRAM_MIN, step: GRAM_STEP }
}

export interface SyncReport {
  ran: boolean
  reason?: string
  startedAt?: string
  seconds?: number
  products?: number
  inStock?: number
  skipped?: { noSku: string[]; excludedCategory: number; archived: number; noProduct: number }
  /** Offers' quantity/in_reserve compared with /offers/stocks for one page, to confirm their meaning. */
  stockCheck?: { compared: number; quantityMismatches: number; reserveMismatches: number; examples: unknown[] }
  /** Photo colours: known after this sync, worked out now, unreadable, left for the next sync. */
  colors?: { known: number; computed: number; failed: number; pending: number }
}

/**
 * Replaces the Redis snapshot with the current KeyCRM catalog. Skips when another
 * sync holds the lock or the last one finished less than `minIntervalMs` ago.
 */
type StoredColor = YarnColor | { failedAt: number }

/**
 * Yarn colour for each photo URL: from the cache, or worked out now for new
 * photos while time allows (the rest are picked up by the next sync).
 */
async function photoColors(urls: string[], deadline: number) {
  const r = await redis()
  const unique = [...new Set(urls.filter(Boolean))]
  const cached = unique.length ? await r.hmGet(KEY_IMAGE_COLOR, unique) : []
  const colors = new Map<string, YarnColor>()
  const todo: string[] = []
  unique.forEach((url, i) => {
    const stored = cached[i] ? (JSON.parse(cached[i]!) as StoredColor) : null
    if (stored && "hex" in stored) colors.set(url, stored)
    else if (!stored || Date.now() - stored.failedAt > COLOR_RETRY_MS) todo.push(url)
  })

  const { yarnColorFromUrl } = await import("@/lib/image-color")
  let computed = 0
  let failed = 0
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: COLOR_CONCURRENCY }, async () => {
      for (let url = queue.shift(); url && Date.now() < deadline; url = queue.shift()) {
        let stored: StoredColor
        try {
          const color = await yarnColorFromUrl(url, AbortSignal.timeout(10_000))
          stored = color ?? { failedAt: Date.now() }
        } catch {
          stored = { failedAt: Date.now() }
        }
        if ("hex" in stored) {
          colors.set(url, stored)
          computed++
        } else failed++
        await r.hSet(KEY_IMAGE_COLOR, url, JSON.stringify(stored))
      }
    }),
  )
  return { colors, report: { known: colors.size, computed, failed, pending: queue.length } }
}

export async function syncCatalog({ minIntervalMs = 0 } = {}): Promise<SyncReport> {
  const r = await redis()
  if (minIntervalMs > 0) {
    const meta = JSON.parse((await r.get(KEY_META)) ?? "null")
    const last = meta?.finishedAt ? Date.parse(meta.finishedAt) : 0
    if (Date.now() - last < minIntervalMs) return { ran: false, reason: "synced recently" }
  }
  const token = String(Math.random())
  if (!(await r.set(KEY_LOCK, token, { NX: true, EX: 600 }))) return { ran: false, reason: "sync already running" }

  const started = Date.now()
  try {
    const [categories, offers, products, stocksPage] = await Promise.all([
      keycrmGetAll("/products/categories"),
      keycrmGetAll("/offers", { include: "product", "filter[is_archived]": "false" }),
      keycrmGetAll("/products", { include: "custom_fields", "filter[is_archived]": "false" }),
      keycrmGetPages("/offers/stocks", {}, 1),
    ])

    const categoryName = new Map<number, string>(categories.map((c: any) => [c.id, String(c.name ?? "").trim()]))
    const productById = new Map<number, any>(products.map((p: any) => [p.id, p]))

    const skipped = { noSku: [] as string[], excludedCategory: 0, archived: 0, noProduct: 0 }
    const catalog: Product[] = []
    const seen = new Set<string>()
    for (const offer of offers) {
      const product = productById.get(offer.product_id) ?? offer.product
      if (!product) {
        skipped.noProduct++
        continue
      }
      if (offer.is_archived || product.is_archived) {
        skipped.archived++
        continue
      }
      const category = categoryName.get(product.category_id) ?? ""
      if (EXCLUDED_CATEGORIES.includes(category.toLowerCase())) {
        skipped.excludedCategory++
        continue
      }
      // Orders reach KeyCRM stock by SKU, so an offer without one can't be sold here.
      const sku = String(offer.sku ?? "").trim()
      if (!sku || seen.has(sku)) {
        if (!sku) skipped.noSku.push(String(product.name ?? offer.id))
        continue
      }
      seen.add(sku)
      catalog.push(toProduct({ ...offer, sku }, product, customFields(productById.get(offer.product_id)), category))
    }

    const offerById = new Map<number, any>(offers.map((o: any) => [o.id, o]))
    const compared = stocksPage.items.filter((s: any) => offerById.has(s.id))
    const quantityOff = compared.filter((s: any) => Number(s.quantity) !== Number(offerById.get(s.id).quantity))
    const reserveOff = compared.filter((s: any) => Number(s.reserve) !== Number(offerById.get(s.id).in_reserve))
    const stockCheck = {
      compared: compared.length,
      quantityMismatches: quantityOff.length,
      reserveMismatches: reserveOff.length,
      examples: [...quantityOff, ...reserveOff].slice(0, 3).map((s: any) => ({
        sku: s.sku,
        stocks: { quantity: s.quantity, reserve: s.reserve },
        offer: { quantity: offerById.get(s.id).quantity, in_reserve: offerById.get(s.id).in_reserve },
      })),
    }

    // Colour of each yarn on sale, from its photo. The group comes from the colour's
    // name in KeyCRM where it's recognised (photos come out darker and greyer than
    // the yarn), else from the photo; the product's name can mark it multicoloured.
    const { colors, report: colorReport } = await photoColors(
      catalog.filter((p) => p.stock > 0).map((p) => p.image),
      started + COLOR_DEADLINE_MS,
    )
    for (const p of catalog) {
      const color = colors.get(p.image)
      if (color) p.colorHex = color.hex
      if (MULTI_NAME.test(`${p.name} ${p.category}`)) p.colorFamily = "multi"
      else p.colorFamily = familyFromName(p.color) ?? color?.family
    }

    // A stock webhook that landed while we were reading KeyCRM is newer than our data: keep it.
    const stockAt = await r.hGetAll(KEY_STOCK_AT)
    const newer = catalog.filter((p) => Number(stockAt[p.sku] ?? 0) > started).map((p) => p.sku)
    const live = newer.length ? await r.hmGet(KEY_STOCK, newer) : []
    const liveStock = new Map(newer.map((sku, i) => [sku, live[i]]))

    const tx = r.multi().del(KEY_PRODUCTS).del(KEY_STOCK).del(KEY_OFFER_SKU)
    if (catalog.length) {
      tx.hSet(KEY_OFFER_SKU, Object.fromEntries(catalog.map((p) => [String(p.offerId), p.sku])))
      tx.hSet(KEY_PRODUCTS, Object.fromEntries(catalog.map((p) => [p.sku, JSON.stringify(p)])))
      tx.hSet(KEY_STOCK, Object.fromEntries(catalog.map((p) => [p.sku, liveStock.get(p.sku) ?? String(p.stock)])))
    }
    const report: SyncReport = {
      ran: true,
      startedAt: new Date(started).toISOString(),
      seconds: Math.round((Date.now() - started) / 1000),
      products: catalog.length,
      inStock: catalog.filter((p) => Number(liveStock.get(p.sku) ?? p.stock) > 0).length,
      skipped: { ...skipped, noSku: skipped.noSku.slice(0, 100) },
      stockCheck,
      colors: colorReport,
    }
    tx.set(KEY_META, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }))
    await tx.exec()
    return report
  } finally {
    if ((await r.get(KEY_LOCK)) === token) await r.del(KEY_LOCK)
  }
}

/**
 * Live stock. Yarn by weight with less than its minimum left (a mistake in the
 * warehouse, or crumbs after reserves) isn't sold: it counts as sold out.
 */
function withLiveStock(p: Product, stock: string | null | undefined): Product {
  const live = stock === null || stock === undefined ? p.stock : Number(stock)
  // Recomputed on read, so a change to the rules applies at once, not after the next sync.
  const limits = quantityLimits(p.name, p.category, p.priceUnit)
  return { ...p, ...limits, stock: p.priceUnit === "г" && live < limits.minQty ? 0 : live }
}

/** Every non-archived product, sold-out ones included, newest first. Empty until the first sync. */
export async function readCatalog(): Promise<Product[]> {
  if (!redisConfigured()) return []
  const r = await redis()
  const [raw, stock] = await Promise.all([r.hVals(KEY_PRODUCTS), r.hGetAll(KEY_STOCK)])
  return raw
    .map((json) => {
      const p = JSON.parse(json) as Product
      return withLiveStock(p, stock[p.sku])
    })
    .sort((a, b) => b.offerId - a.offerId)
}

/** Current data for the given SKUs (unknown ones are left out). */
export async function readProducts(skus: string[]): Promise<Product[]> {
  if (!redisConfigured() || skus.length === 0) return []
  const r = await redis()
  const [raw, stock] = await Promise.all([r.hmGet(KEY_PRODUCTS, skus), r.hmGet(KEY_STOCK, skus)])
  return raw.flatMap((json, i) => (json ? [withLiveStock(JSON.parse(json) as Product, stock[i])] : []))
}

export async function readCatalogMeta(): Promise<(SyncReport & { finishedAt?: string }) | null> {
  if (!redisConfigured()) return null
  return JSON.parse((await (await redis()).get(KEY_META)) ?? "null")
}

/**
 * Takes sold quantities off the live stock right away, so the site stops offering
 * them before KeyCRM's reservation comes back through the next sync or webhook.
 */
export async function reserveStock(items: { sku: string; quantity: number }[]): Promise<void> {
  if (!redisConfigured() || items.length === 0) return
  const r = await redis()
  const now = String(Date.now())
  const tx = r.multi()
  for (const { sku, quantity } of items) {
    tx.hIncrBy(KEY_STOCK, sku, -Math.round(quantity))
    tx.hSet(KEY_STOCK_AT, sku, now)
  }
  await tx.exec()
}

export interface StockUpdate {
  sku?: string
  offerId?: number
  /** Total over all warehouses. */
  inStock: number
  inReserve: number
}

/**
 * Applies stock levels pushed by the KeyCRM webhook. Returns the SKUs that were
 * updated; products the site doesn't list yet arrive with the next sync.
 */
export async function applyStockUpdates(updates: StockUpdate[]): Promise<string[]> {
  if (!redisConfigured() || updates.length === 0) return []
  const r = await redis()
  const byId = updates.filter((u) => !u.sku && u.offerId).map((u) => String(u.offerId))
  const idSkus = byId.length ? await r.hmGet(KEY_OFFER_SKU, byId) : []
  const skuOf = new Map(byId.map((id, i) => [id, idSkus[i]]))

  const resolved = updates.flatMap((u) => {
    const sku = u.sku || skuOf.get(String(u.offerId))
    return sku ? [{ sku, stock: Math.max(0, Math.floor(u.inStock - u.inReserve)) }] : []
  })
  if (resolved.length === 0) return []
  const known = await r.hmGet(KEY_PRODUCTS, resolved.map((u) => u.sku))
  const toApply = resolved.filter((_, i) => known[i])
  if (toApply.length === 0) return []

  const now = String(Date.now())
  const tx = r.multi()
  for (const { sku, stock } of toApply) {
    tx.hSet(KEY_STOCK, sku, String(stock))
    tx.hSet(KEY_STOCK_AT, sku, now)
  }
  await tx.exec()
  return toApply.map((u) => u.sku)
}
