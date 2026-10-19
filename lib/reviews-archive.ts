// Server-only: the «Відгуки» topic's history from before reviews went to the
// site by themselves (Oct 2025 – Oct 2026), read once from the Telegram export
// into content/reviews-archive.json, with the item photos in public/reviews.
//
// The reviews cron (`loadArchive`) puts them in Redis (lib/reviews.ts) when
// the file is new or changed, matching them to the catalog as it is then; a
// review taken out of the file is taken off the site. To correct or remove
// one, edit the file.
//
// Redis keys:
//   rv:archive:version   hash of the file last loaded
//   rv:archive:ids       set   review ids that came from it

import { createHash } from "node:crypto"
import archive from "@/content/reviews-archive.json"
import { readCatalog } from "@/lib/catalog"
import { redis } from "@/lib/redis"
import { type Review, type ReviewPhoto, deleteReview, matchProducts, saveReviews } from "@/lib/reviews"

const KEY_VERSION = "rv:archive:version"
const KEY_IDS = "rv:archive:ids"

export interface ArchivedReview {
  id: string
  at: string
  author: string
  text: string
  photos: ReviewPhoto[]
  /** Links, SKUs and names from the manager's words and the screenshots, for lib/reviews.ts's matching. */
  mentions: string[]
  /** The yarn as the manager named it. */
  title: string
  /** The category it was read as. */
  category: string
}

export async function loadArchive(): Promise<{ loaded: number; removed: number } | null> {
  const entries = archive as ArchivedReview[]
  const version = createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16)
  const r = await redis()
  if ((await r.get(KEY_VERSION)) === version) return null
  const catalog = await readCatalog()
  const reviews: Review[] = entries.map((e) => ({
    id: e.id,
    at: e.at,
    author: e.author,
    text: e.text,
    photos: e.photos,
    ...matchProducts(e.mentions, catalog, e.category, e.title),
  }))
  const keep = new Set(reviews.map((x) => x.id))
  const gone = (await r.sMembers(KEY_IDS)).filter((id) => !keep.has(id))
  for (const id of gone) await deleteReview(id, catalog)
  await saveReviews(reviews, catalog)
  const m = r.multi().del(KEY_IDS)
  if (keep.size) m.sAdd(KEY_IDS, [...keep])
  await m.set(KEY_VERSION, version).exec()
  return { loaded: reviews.length, removed: gone.length }
}
