// Addresses of the old WordPress/WooCommerce shop on the same domain
// (/product/<slug>/, /product-category/<slug>/). Links to them live on in
// Google, Instagram posts and bookmarks, so they're matched to the new pages
// instead of ending on "not found".
//
// WordPress slugs are the product name, either kept in Cyrillic (sent
// percent-encoded) or transliterated by a plugin with its own spelling rules.
// Both sides are reduced to a rough Latin "skeleton" so the spellings meet.

import type { Product } from "@/components/shop/data"

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh",
  ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ё: "e", ы: "y", э: "e", ъ: "",
}

/**
 * One word in a spelling-neutral form: transliterated, then the letters and
 * pairs that transliteration rules disagree on folded together
 * (х = kh/h/x, й/и/і/ї = i/y/j/yi, щ = shch/shh/sch, є/ю/я = ye/ie/yu/iu/ya/ia, г/ґ = h/g…).
 */
export function skeleton(word: string): string {
  return [...word.toLowerCase()]
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/g, "")
    .replace(/shch|shh|sch/g, "s")
    .replace(/kh|x/g, "h")
    .replace(/zh/g, "z")
    .replace(/ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/ts|tz/g, "c")
    .replace(/[jy]/g, "i")
    .replace(/w/g, "v")
    .replace(/g/g, "h")
    .replace(/q/g, "k")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/i(?=[aeiou])/g, "")
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** A word of an old slug or a product name, as a skeleton. */
interface Word {
  text: string
  /** A number that tells products apart (article, colour, code): a product must have it. */
  key: boolean
  num: boolean
}

/** Units after a number: weight and length («25г», «160m») don't tell products apart. */
const UNIT = /^(г|гр|g|gr|м|m|мм|mm|см|cm|кг|kg|шт|sht|%)$/i

/**
 * The words of a slug or a name. Letters and digits stuck together are split
 * («l430» → l, 430; «x14» → x, 14), numbers lose leading zeros («00180» = 180),
 * and a number with a unit («25г») is kept but not required.
 */
export function words(text: string): Word[] {
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    // Not percent-encoded.
  }
  const out: Word[] = []
  for (const raw of decoded.toLowerCase().split(/[^\p{L}\p{N}%]+/u)) {
    const unit = /^(\d+)([\p{L}%]+)$/u.exec(raw)
    if (unit && UNIT.test(unit[2])) {
      out.push({ text: String(Number(unit[1])), key: false, num: true })
      continue
    }
    for (const part of raw.match(/\d+|[^\d%]+/g) ?? []) {
      if (/^\d+$/.test(part)) out.push({ text: String(Number(part)), key: true, num: true })
      else {
        const text = skeleton(part)
        if (text) out.push({ text, key: false, num: false })
      }
    }
  }
  return out
}

const weight = (w: Word) => (w.key ? 3 : 1)
const productWords = (p: Product) => words([p.name, p.sku, p.color, p.article].join(" "))

interface Candidate {
  product: Product
  score: number
}

/** Products that could be the one an old slug was about, best first. Exported for the log of misses. */
export function rankOldProduct(slug: string, products: Product[]): { candidates: Candidate[]; possible: number } {
  const wanted = words(slug)
  const keys = wanted.filter((w) => w.key).map((w) => w.text)
  const candidates: Candidate[] = []
  for (const product of products) {
    const own = new Set(productWords(product).map((w) => w.text))
    if (!keys.every((k) => own.has(k))) continue
    const score = wanted.reduce((s, w) => s + (own.has(w.text) ? weight(w) : 0), 0)
    if (score > 0) candidates.push({ product, score })
  }
  candidates.sort((a, b) => b.score - a.score)
  return { candidates, possible: wanted.reduce((s, w) => s + weight(w), 0) }
}

const nameKey = (p: Product) =>
  words(p.name)
    .map((w) => w.text)
    .join(" ")
const sameName = (a: Product, b: Product) => nameKey(a) === nameKey(b)

function matchWords(slug: string, products: Product[]): Product | null {
  const { candidates, possible } = rankOldProduct(slug, products)
  if (candidates.length === 0 || candidates[0].score < possible * 0.6) return null
  const best = candidates.filter((c) => c.score === candidates[0].score).map((c) => c.product)
  // Several products with the same name (one spool per batch in KeyCRM) are the
  // same yarn: take one in stock. Different names scoring the same: unclear.
  if (best.length > 1 && !best.every((p) => sameName(p, best[0]))) return null
  return best.find((p) => p.stock > 0) ?? best[0]
}

/**
 * The product an old /product/<slug> address was about, or null when no
 * product matches clearly. Every article, colour or code number in the slug
 * must be in the product; words and weights count for less.
 */
export function matchOldProduct(slug: string, products: Product[]): Product | null {
  // Old slugs often end with the SKU itself («…-shu224», «…-m813»). Only a
  // code with letters counts: a bare number may be another colour's article.
  const last = safeDecode(slug).toLowerCase().replace(/-\d$/, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop() ?? ""
  if (/\p{L}/u.test(last) && /\d/.test(last)) {
    const bySku = products.find((p) => p.sku.toLowerCase() === last)
    if (bySku) return bySku
  }
  const found = matchWords(slug, products)
  // WordPress adds "-2", "-3"… to a repeated name.
  const plain = slug.replace(/-\d$/, "")
  return found ?? (plain !== slug ? matchWords(plain, products) : null)
}

/** Category of an old /product-category/<slug> address, by the words of its name. */
export function matchOldCategory(slug: string, categories: string[]): string | null {
  const wanted = new Set(words(slug).map((w) => w.text))
  if (wanted.size === 0) return null
  let best: string | null = null
  let bestScore = 0
  for (const name of categories) {
    const own = words(name).map((w) => w.text)
    if (own.length === 0) continue
    const hits = own.filter((w) => wanted.has(w)).length
    // Share of both: the slug's words found, and the name's words used.
    const score = hits / Math.max(wanted.size, own.length)
    if (score > bestScore) {
      best = name
      bestScore = score
    }
  }
  return bestScore >= 0.5 ? best : null
}

/**
 * Where to send an old product address no product matches: a catalog search
 * for its longest number (an article or colour number), else the catalog.
 */
export function fallbackSearch(slug: string): string {
  const numbers = words(slug)
    .filter((w) => w.key)
    .map((w) => w.text)
    .sort((a, b) => b.length - a.length)
  return numbers.length ? `/?q=${encodeURIComponent(numbers[0])}` : "/"
}
