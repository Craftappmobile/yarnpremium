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

/** Words of an old slug or a product name, as skeletons. */
export function words(text: string): string[] {
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    // Not percent-encoded.
  }
  return decoded
    .split(/[^\p{L}\p{N}]+/u)
    .map(skeleton)
    .filter(Boolean)
}

const isNumber = (w: string) => /^\d+$/.test(w)

/**
 * The product an old /product/<slug> address was about, or null when no
 * product matches clearly. Every number in the slug (article and colour
 * numbers) must be in the product; words count for less.
 */
export function matchOldProduct(slug: string, products: Product[]): Product | null {
  const found = matchWords(slug, products)
  // WordPress adds "-2", "-3"… to a repeated name.
  const plain = slug.replace(/-\d$/, "")
  return found ?? (plain !== slug ? matchWords(plain, products) : null)
}

function matchWords(slug: string, products: Product[]): Product | null {
  const wanted = words(slug)
  if (wanted.length === 0) return null
  const numbers = wanted.filter(isNumber)
  let best: Product | null = null
  let bestScore = 0
  let tie = false
  for (const p of products) {
    const own = new Set(words([p.name, p.sku, p.color, p.article].join(" ")))
    if (!numbers.every((n) => own.has(n))) continue
    const score = wanted.reduce((s, w) => s + (own.has(w) ? (isNumber(w) ? 3 : 1) : 0), 0)
    if (score > bestScore) {
      best = p
      bestScore = score
      tie = false
    } else if (score === bestScore) {
      tie = true
    }
  }
  const possible = wanted.reduce((s, w) => s + (isNumber(w) ? 3 : 1), 0)
  // Most of the slug must be found, and in one product only.
  return best && !tie && bestScore >= possible * 0.6 ? best : null
}

/** Category of an old /product-category/<slug> address, by the words of its name. */
export function matchOldCategory(slug: string, categories: string[]): string | null {
  const wanted = new Set(words(slug))
  if (wanted.size === 0) return null
  let best: string | null = null
  let bestScore = 0
  for (const name of categories) {
    const own = words(name)
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
    .filter(isNumber)
    .sort((a, b) => b.length - a.length)
  return numbers.length ? `/?q=${encodeURIComponent(numbers[0])}` : "/"
}
