// Every KeyCRM category has its own address, /kategoriya/<its name in Latin
// letters>: «Мериноси тонкі» → /kategoriya/merynosy-tonki. Worked out from the
// name alone, so links can be made anywhere without the catalog; renaming a
// category in KeyCRM moves its page (the old address then goes to the catalog).

// Ukrainian transliteration as in the passport rules (КМУ №55, 2010); a few
// Russian letters, since some names come from suppliers.
const LETTERS: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh",
  ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ё: "io", ъ: "",
}
/** At the start of a word these are written as they sound. */
const WORD_START: Record<string, string> = { є: "ye", ї: "yi", й: "y", ю: "yu", я: "ya" }

export function categorySlug(category: string): string {
  const text = category.toLowerCase().replace(/['’ʼ`]/g, "")
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const atStart = i === 0 || !/[\p{L}]/u.test(text[i - 1])
    // «зг» is written «zgh», so it isn't read as «ж».
    if (c === "г" && text[i - 1] === "з") out += "gh"
    else out += (atStart && WORD_START[c]) || (LETTERS[c] ?? c)
  }
  return out
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function categoryPath(category: string): string {
  return `/kategoriya/${categorySlug(category)}`
}

/** The category an address names, out of those given; the one with more products wins a clash. */
export function categoryBySlug(slug: string, categories: string[]): string | undefined {
  return categories.find((c) => categorySlug(c) === slug)
}

/** The tab title of a category's page (the layout adds « — SINCERITA»). */
export function categoryTitle(category: string): string {
  return `${category}: купити пряжу`
}
