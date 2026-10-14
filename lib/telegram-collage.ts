// Server-only: several product photos as one picture, for a Telegram post.
// An album (several photos) can't carry buttons in Telegram; one picture can,
// so a post shows every colour and its «see all» button together.

import sharp from "sharp"

/** Width of the picture; Telegram shows photos up to about this size. */
const WIDTH = 1280
const GAP = 8
const MAX_TILES = 9

/** Tiles that fill whole rows: 2 or 3 side by side, 2×2, 3×2 or 3×3. */
const fullGrid = (n: number) => (n >= 9 ? 9 : n >= 6 ? 6 : n >= 4 ? 4 : n)
const columns = (n: number) => (n <= 3 ? n : n === 4 ? 2 : 3)

/**
 * The photos at these URLs tiled into one JPEG, or null when fewer than two
 * could be read. Photos that can't be fetched or decoded are left out, and so
 * are the last ones that wouldn't fill a row (the post's text lists them all).
 */
export async function collage(urls: string[]): Promise<Buffer | null> {
  const read = await Promise.all(
    urls.slice(0, MAX_TILES).map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        return res.ok ? Buffer.from(await res.arrayBuffer()) : null
      } catch {
        return null
      }
    }),
  )
  const n0 = read.filter(Boolean).length
  if (n0 < 2) return null
  const cols = columns(fullGrid(n0))
  const cell = Math.floor((WIDTH - GAP * (cols + 1)) / cols)
  const tiles = (
    await Promise.all(
      read.map((buf) =>
        buf
          ? sharp(buf).rotate().resize(cell, cell, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer().catch(() => null)
          : null,
      ),
    )
  )
    .filter((t): t is Buffer => Boolean(t))
    .slice(0, fullGrid(n0))
  if (tiles.length < 2) return null
  tiles.splice(fullGrid(tiles.length))
  // Laid out again if a photo failed to decode, so no hole is left.
  const c = columns(tiles.length)
  const size = Math.floor((WIDTH - GAP * (c + 1)) / c)
  const rows = Math.ceil(tiles.length / c)
  const resized =
    size === cell ? tiles : await Promise.all(tiles.map((t) => sharp(t).resize(size, size, { fit: "cover" }).toBuffer()))
  return sharp({
    create: { width: WIDTH, height: rows * size + GAP * (rows + 1), channels: 3, background: "#ffffff" },
  })
    .composite(resized.map((input, i) => ({ input, left: GAP + (i % c) * (size + GAP), top: GAP + Math.floor(i / c) * (size + GAP) })))
    .jpeg({ quality: 85 })
    .toBuffer()
}
