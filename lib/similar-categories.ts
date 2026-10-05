import type { GroupSummary } from "@/components/shop/catalog-summary"
import { CATEGORY_NOTES } from "@/lib/categories"

// Categories like a sold-out one, for its page: the closest in fibres, by
// their names and composition lines (shared fibres over all fibres of both,
// so pure merino comes before half-wool for merino). Then whatever has the
// most in stock.

const FIBRES: RegExp[] = [
  /мерин/,
  /кашем|cash/,
  /шовк|silk|seta/,
  /альпак|лам[аи]/,
  /мохер|кід|kid/,
  /льон|lino/,
  /бавовн|котон|cotton/,
  /пай?єтк|бусин/,
  /(^|[^а-яіїєґ])як([^а-яіїєґ]|$)/,
  /верблюд/,
  /ангор/,
  /віскоз/,
  /люрекс/,
  /вовн/,
]

function fibres(text: string): Set<number> {
  const t = text.toLowerCase()
  return new Set(FIBRES.flatMap((re, i) => (re.test(t) ? [i] : [])))
}

const describe = (g: Pick<GroupSummary, "category" | "composition">) =>
  `${g.category} ${CATEGORY_NOTES[g.category] ?? g.composition ?? ""}`

/** Up to `limit` categories in stock like `category`; `groups` are most stocked first. */
export function similarCategories(category: string, groups: GroupSummary[], limit = 4): GroupSummary[] {
  const own = fibres(describe({ category }))
  const scored = groups
    .filter((g) => g.category !== category)
    .map((g, rank) => {
      const theirs = fibres(describe(g))
      const shared = [...theirs].filter((f) => own.has(f)).length
      return { g, rank, score: shared / (own.size + theirs.size - shared || 1) }
    })
  const like = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.rank - b.rank)
  const rest = scored.filter((s) => s.score === 0)
  return [...like, ...rest].slice(0, limit).map((s) => s.g)
}
