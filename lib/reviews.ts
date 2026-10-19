// Server-only: buyers' reviews shown on product pages («Відгуки покупців») and
// on /vidguky. They come from the staff group's «Відгуки» topic in Telegram,
// where managers post screenshots of buyers' messages and photos of finished
// items (lib/reviews-intake.ts), and from the one-off import of that topic's
// history.
//
// A review is about one or more products (SKUs), and through them about a
// yarn (KeyCRM «Артикул», the same for every colour of it) and a category.
// A product page shows the reviews of that product first, then of other
// colours of the same yarn, then of its category: most of the reviewed stock
// yarn is sold out by now, and a review of it still tells about the yarn type.
//
// Redis keys:
//   rv:items           hash  review id -> Review JSON
//   rv:idx:all         zset  review ids by date
//   rv:idx:sku:<sku>   zset  the same, per product
//   rv:idx:line:<a>    zset  per yarn («Артикул», lower case)
//   rv:idx:cat:<c>     zset  per category (lower case)

import { revalidatePath } from "next/cache"
import type { Product } from "@/components/shop/data"
import { matchOldProduct } from "@/lib/old-urls"
import { redis } from "@/lib/redis"

const KEY_ITEMS = "rv:items"
const KEY_ALL = "rv:idx:all"
const idx = (kind: "sku" | "line" | "cat", value: string) => `rv:idx:${kind}:${value.toLowerCase()}`

/** Mixes every fibre: no use as «the same kind of yarn». */
const SALE_CATEGORY = "акційний товар"

export interface ReviewPhoto {
  /** Telegram's file_unique_id; the file is served by app/review-photo (lib/reviews-intake.ts). */
  id: string
  /** A photo kept with the site instead (the imported history, public/reviews). */
  src?: string
  w: number
  h: number
}

export interface Review {
  id: string
  /** When the buyer wrote it (as far as known: when it was posted in the topic). */
  at: string
  /** «Олена К.»; empty when unknown. */
  author: string
  text: string
  /** Photos of the finished item or the yarn, never the chat screenshots. */
  photos: ReviewPhoto[]
  skus: string[]
  /** The yarn's «Артикул», lower case. */
  line: string | null
  category: string
  /** What it is about, in words, for the card: the product's name, or the yarn as the manager wrote it. */
  about: string
  /** Where it came from in the staff group, so a manager can remove or correct it there. */
  source?: { chatId: number; messageIds: number[]; replyId?: number }
}

// ---------------------------------------------------------------------------
// Which products a manager's words name

/** Cyrillic letters that look like Latin ones: «СH616» is typed with a Cyrillic С. */
const LOOKALIKE: Record<string, string> = { а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", х: "x", і: "i" }

/** «MER 1250 - 1», «mer1250-1» and «MЕR1250-1» (Cyrillic Е) are one SKU. */
export function skuKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[авекмнорстхі]/g, (c) => LOOKALIKE[c])
    .replace(/[\s\-–—_.]/g, "")
}

/** Article and SKU-like tokens: «MER167-5», «KSH 750», «ST43-7». */
const SKU_LIKE = /(?<!\p{L})[a-zа-яіїєґ]{1,5}\s?\d{1,5}(?:\s?[-–]\s?\d{1,3})?/giu
const PRODUCT_LINK = /\/product\/([^/?#\s]+)/gi

export interface ReviewMatch {
  skus: string[]
  line: string | null
  category: string
  about: string
}

const isWord = (text: string, word: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text)

/**
 * The products a review is about, from what the manager wrote and what the
 * screenshots show (`mentions`): links to the site, SKUs, the yarn's
 * «Артикул», a category's name. `category` is the model's guess, used when
 * nothing more exact is found; `title` is the yarn as the manager named it.
 */
export function matchProducts(mentions: string[], catalog: Product[], category = "", title = ""): ReviewMatch {
  const text = mentions.join("\n")
  const bySku = new Map(catalog.map((p) => [skuKey(p.sku), p]))
  const found = new Map<string, Product>()

  for (const m of text.matchAll(PRODUCT_LINK)) {
    let slug = m[1]
    try {
      slug = decodeURIComponent(slug)
    } catch {}
    const p = bySku.get(skuKey(slug)) ?? matchOldProduct(m[1], catalog)
    if (p) found.set(p.sku, p)
  }
  for (const m of text.matchAll(SKU_LIKE)) {
    const p = bySku.get(skuKey(m[0]))
    if (p) found.set(p.sku, p)
  }

  const products = [...found.values()]
  const categories = [...new Set(catalog.map((p) => p.category).filter(Boolean))]
  const usable = (c: string) => (c && c.toLowerCase() !== SALE_CATEGORY ? c : "")

  if (products.length) {
    const lines = new Set(products.map((p) => p.article.toLowerCase()))
    const cats = new Set(products.map((p) => p.category))
    return {
      skus: products.map((p) => p.sku),
      line: lines.size === 1 && products[0].article ? products[0].article.toLowerCase() : null,
      category: cats.size === 1 ? usable(products[0].category) : "",
      about: products.length === 1 ? products[0].name : products.map((p) => p.name).join(", ").slice(0, 200),
    }
  }

  // No product named: the yarn by its «Артикул» («Cashwool», «Jaipur»), else a category.
  const articles = [...new Set(catalog.map((p) => p.article).filter((a) => a.length >= 4))]
  const article = articles.filter((a) => isWord(text, a)).sort((a, b) => b.length - a.length)[0]
  const sample = article ? catalog.find((p) => p.article === article) : undefined
  const named = categories.filter((c) => usable(c) && isWord(text, c)).sort((a, b) => b.length - a.length)[0]
  const guessed = categories.find((c) => c.toLowerCase() === category.toLowerCase())
  return {
    skus: [],
    line: article ? article.toLowerCase() : null,
    category: usable(sample?.category ?? "") || usable(named ?? "") || usable(guessed ?? ""),
    about: title.trim().slice(0, 200) || article || named || "",
  }
}

// ---------------------------------------------------------------------------
// Storage

function indexKeys(r: Pick<Review, "skus" | "line" | "category">): string[] {
  return [
    KEY_ALL,
    ...r.skus.map((s) => idx("sku", s)),
    ...(r.line ? [idx("line", r.line)] : []),
    ...(r.category ? [idx("cat", r.category)] : []),
  ]
}

export async function readReview(id: string): Promise<Review | null> {
  const raw = await (await redis()).hGet(KEY_ITEMS, id)
  return raw ? JSON.parse(raw) : null
}

/** Saves a review, new or changed (its products may differ), and rebuilds the pages that show it. */
export async function saveReview(review: Review, catalog: Product[]): Promise<void> {
  await saveReviews([review], catalog)
}

/** Many at once (the imported history): the pages are rebuilt once, all of them if need be. */
export async function saveReviews(reviews: Review[], catalog: Product[]): Promise<void> {
  if (reviews.length === 0) return
  const r = await redis()
  const raw = await r.hmGet(KEY_ITEMS, reviews.map((x) => x.id))
  const before = raw.map((j) => (j ? (JSON.parse(j) as Review) : null))
  const m = r.multi()
  reviews.forEach((review, i) => {
    const old = before[i]
    if (old) for (const k of indexKeys(old)) m.zRem(k, review.id)
    m.hSet(KEY_ITEMS, review.id, JSON.stringify(review))
    const score = Date.parse(review.at) || Date.now()
    for (const k of indexKeys(review)) m.zAdd(k, { score, value: review.id })
  })
  await m.exec()
  refreshPages([...before, ...reviews], catalog)
}

export async function deleteReview(id: string, catalog: Product[]): Promise<Review | null> {
  const r = await redis()
  const review = await readReview(id)
  if (!review) return null
  const m = r.multi()
  for (const k of indexKeys(review)) m.zRem(k, id)
  m.hDel(KEY_ITEMS, id)
  await m.exec()
  refreshPages([review], catalog)
  return review
}

/**
 * Product pages are cached for an hour (app/product/[sku]): the reviewed
 * products and other colours of the same yarn are rebuilt at once, the rest
 * of the category within the hour (all of them at once after an import).
 */
function refreshPages(reviews: (Review | null)[], catalog: Product[]) {
  const skus = new Set<string>()
  for (const r of reviews) {
    if (!r) continue
    for (const s of r.skus) skus.add(s)
    if (r.line) for (const p of catalog) if (p.article.toLowerCase() === r.line) skus.add(p.sku)
  }
  try {
    revalidatePath("/vidguky")
    // Many at once (the import): every product page, the category's ones included.
    if (reviews.length > 20 || skus.size > 400) revalidatePath("/product/[sku]", "page")
    else for (const s of skus) revalidatePath(`/product/${encodeURIComponent(s)}`)
  } catch {
    // Outside a request (the import script): nothing is cached there.
  }
}

async function readMany(ids: string[]): Promise<Review[]> {
  if (ids.length === 0) return []
  const raw = await (await redis()).hmGet(KEY_ITEMS, ids)
  return raw.flatMap((j) => (j ? [JSON.parse(j) as Review] : []))
}

/** For a product page: its own reviews first, then other colours of the yarn, then the category. */
export async function reviewsForProduct(product: Product, limit = 6): Promise<Review[]> {
  const r = await redis()
  const keys = [
    idx("sku", product.sku),
    ...(product.article ? [idx("line", product.article)] : []),
    ...(product.category && product.category.toLowerCase() !== SALE_CATEGORY ? [idx("cat", product.category)] : []),
  ]
  const lists = await Promise.all(keys.map((k) => r.zRange(k, 0, limit - 1, { REV: true })))
  return readMany([...new Set(lists.flat())].slice(0, limit))
}

export async function latestReviews(offset: number, limit: number): Promise<{ reviews: Review[]; total: number }> {
  const r = await redis()
  const [ids, total] = await Promise.all([r.zRange(KEY_ALL, offset, offset + limit - 1, { REV: true }), r.zCard(KEY_ALL)])
  return { reviews: await readMany(ids), total }
}

export async function reviewCount(): Promise<number> {
  return (await redis()).zCard(KEY_ALL)
}
