// Rubrics of the Telegram channel: KeyCRM categories grouped by what the yarn
// is, so the channel and the bot's subscribers get «Оновлення: Меринос», not a
// post per KeyCRM category. A category goes to the first rubric whose pattern
// its name matches (so «Кашемір меринос» is cashmere, «Мікропаєтка на
// бавовні» is sequins). A category no pattern matches (a mixed stock lot like
// «Сток Шанель») is read from the product's name instead, by the fibre named
// first («Альпака з мериносом» is alpaca); failing that, «Інша пряжа».
// `key` is what the bot's links and the post's UTM tags carry: keep it stable.

export interface Rubric {
  key: string
  title: string
  hashtag: string
  /** Matched against the KeyCRM category, lower-cased (or the product's name, see rubricOf). */
  pattern?: RegExp
}

export const RUBRICS: Rubric[] = [
  { key: "sale", title: "Акції", hashtag: "#акції", pattern: /^акційн/ },
  { key: "cashmere", title: "Кашемір", hashtag: "#кашемір", pattern: /кашем/ },
  { key: "sequins", title: "Паєтка і люрекс", hashtag: "#паєтка", pattern: /па[йє]?єтк|пайєтк|бусин|люрекс/ },
  { key: "mohair", title: "Мохер і кід", hashtag: "#мохер", pattern: /мохер|(^|[^а-яіїєґ])кід/ },
  { key: "merino", title: "Меринос", hashtag: "#меринос", pattern: /мерин|напіввовн|шкарпетк/ },
  { key: "alpaca", title: "Альпака і як", hashtag: "#альпака", pattern: /альпак|(^|[^а-яіїєґ])як([^а-яіїєґ]|$)|верблюд/ },
  { key: "linen", title: "Льон і бавовна", hashtag: "#льон", pattern: /льон|бавовн|котон|кропив|коноп|евкаліпт/ },
  { key: "other", title: "Інша пряжа", hashtag: "#пряжа" },
]

const OTHER = RUBRICS[RUBRICS.length - 1]

export function rubricOf(category: string, name = ""): Rubric {
  const c = category.trim().toLowerCase()
  const byCategory = RUBRICS.find((r) => r.pattern?.test(c))
  if (byCategory) return byCategory
  const n = name.toLowerCase()
  let first: { rubric: Rubric; at: number } | undefined
  for (const rubric of RUBRICS) {
    // «Акції» is a KeyCRM category, never a fibre.
    if (!rubric.pattern || rubric.key === "sale") continue
    const at = n.search(rubric.pattern)
    if (at !== -1 && (!first || at < first.at)) first = { rubric, at }
  }
  return first?.rubric ?? OTHER
}

export function rubricByKey(key: string): Rubric | undefined {
  return RUBRICS.find((r) => r.key === key)
}
