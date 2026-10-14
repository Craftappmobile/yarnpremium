// Rubrics of the Telegram channel: KeyCRM categories grouped by what the yarn
// is, so the channel and the bot's subscribers get «Оновлення: Меринос», not a
// post per KeyCRM category. A category goes to the first rubric whose pattern
// its name matches (so «Кашемір меринос» is cashmere, «Мікропаєтка на
// бавовні» is sequins); a category no pattern matches goes to «Інша пряжа».
// `key` is what the bot's links and the post's UTM tags carry: keep it stable.

export interface Rubric {
  key: string
  title: string
  hashtag: string
  /** Matched against the KeyCRM category, lower-cased. */
  pattern?: RegExp
}

export const RUBRICS: Rubric[] = [
  { key: "sale", title: "Акції", hashtag: "#акції", pattern: /^акційн/ },
  { key: "cashmere", title: "Кашемір", hashtag: "#кашемір", pattern: /кашем/ },
  { key: "sequins", title: "Паєтка і люрекс", hashtag: "#паєтка", pattern: /па[йє]?єтк|пайєтк|бусин|люрекс/ },
  { key: "mohair", title: "Мохер і кід", hashtag: "#мохер", pattern: /мохер|(^|[^а-яіїєґ])кід/ },
  { key: "merino", title: "Меринос", hashtag: "#меринос", pattern: /мерин|напіввовн|шкарпетк/ },
  { key: "alpaca", title: "Альпака і як", hashtag: "#альпака", pattern: /альпак|(^|[^а-яіїєґ])як([^а-яіїєґ]|$)|верблюд/ },
  { key: "linen", title: "Льон і бавовна", hashtag: "#льон", pattern: /льон|бавовн|котон/ },
  { key: "other", title: "Інша пряжа", hashtag: "#пряжа" },
]

const OTHER = RUBRICS[RUBRICS.length - 1]

export function rubricOf(category: string): Rubric {
  const c = category.trim().toLowerCase()
  return RUBRICS.find((r) => r.pattern?.test(c)) ?? OTHER
}

export function rubricByKey(key: string): Rubric | undefined {
  return RUBRICS.find((r) => r.key === key)
}
