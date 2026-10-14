// Server-only: several product photos as one picture, for a Telegram post.
// An album (several photos) can't carry buttons in Telegram; one picture can,
// so a post shows every colour and its «see all» button together. Numbered
// tiles match the numbers before the products' names in the post's text, so
// a buyer can tell which colour is which.

import sharp from "sharp"

/** Width of the picture; Telegram shows photos up to about this size. */
const WIDTH = 1280
const GAP = 8
export const MAX_TILES = 9
/** Behind a photo that couldn't be read: the tile and its number stay, so the numbers still match. */
const PLACEHOLDER = "#ece7df"

/** Tiles that fill whole rows: 2 or 3 side by side, 2×2, 3×2 or 3×3. */
export const fullGrid = (n: number) => (n >= 9 ? 9 : n >= 6 ? 6 : n >= 4 ? 4 : n)
const columns = (n: number) => (n <= 3 ? n : n === 4 ? 2 : 3)

/**
 * Digits drawn as strokes on a 10×16 grid. Text in an SVG needs fonts, which
 * a serverless function may not have; lines need nothing.
 */
const DIGITS: Record<number, string> = {
  1: '<path d="M3 4.5 6 2V14"/>',
  2: '<path d="M2.2 5Q2.4 2 5.1 2 8 2 8 4.9 8 7 2 14H8.2"/>',
  3: '<path d="M2.3 2H8L4.7 6.9Q8.2 6.9 8.2 10.4 8.2 14 5 14 2.6 14 1.9 12.3"/>',
  4: '<path d="M6.8 14V2L1.8 10.2H8.8"/>',
  5: '<path d="M7.8 2H3.1L2.4 7.4Q3.6 6.6 5 6.6 8.3 6.6 8.3 10.2 8.3 14 4.9 14 2.6 14 1.9 12.4"/>',
  6: '<path d="M7.4 2.4Q2.2 3 2.2 9.6 2.2 14 5.2 14 8.2 14 8.2 10.6 8.2 7.4 5.2 7.4 2.9 7.4 2.3 9.6"/>',
  7: '<path d="M1.9 2H8.2L4 14"/>',
  8: '<circle cx="5" cy="4.9" r="2.8"/><circle cx="5" cy="10.8" r="3.2"/>',
  9: '<path d="M2.6 13.6Q7.8 13 7.8 6.4 7.8 2 4.8 2 1.8 2 1.8 5.4 1.8 8.6 4.8 8.6 7.1 8.6 7.7 6.4"/>',
}

/** A round dark badge with a white digit, `size` pixels across. */
function badge(n: number, size: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20">` +
      `<circle cx="10" cy="10" r="9.6" fill="#1b1b1b" fill-opacity="0.82" stroke="#ffffff" stroke-width="0.8"/>` +
      `<g transform="translate(5.5 2.8) scale(0.9)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${DIGITS[n] ?? ""}</g>` +
      `</svg>`,
  )
}

/**
 * The photos at these URLs tiled into one JPEG, in order, numbered from 1 when
 * `numbered`. Lay out a count `fullGrid` keeps whole. Null when fewer than two
 * photos could be read; a photo that can't be read leaves a plain tile.
 */
export async function collage(urls: string[], numbered = false): Promise<Buffer | null> {
  const list = urls.slice(0, MAX_TILES)
  if (list.length < 2) return null
  const cols = columns(list.length)
  const cell = Math.floor((WIDTH - GAP * (cols + 1)) / cols)
  const tiles = await Promise.all(
    list.map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!res.ok) return null
        return await sharp(Buffer.from(await res.arrayBuffer()))
          .rotate()
          .resize(cell, cell, { fit: "cover" })
          .jpeg({ quality: 88 })
          .toBuffer()
      } catch {
        return null
      }
    }),
  )
  if (tiles.filter(Boolean).length < 2) return null

  const rows = Math.ceil(list.length / cols)
  const badgeSize = Math.max(52, Math.round(cell * 0.2))
  const margin = Math.round(cell * 0.045)
  const layers = await Promise.all(
    tiles.map(async (tile, i) => {
      const left = GAP + (i % cols) * (cell + GAP)
      const top = GAP + Math.floor(i / cols) * (cell + GAP)
      const input =
        tile ??
        (await sharp({ create: { width: cell, height: cell, channels: 3, background: PLACEHOLDER } }).jpeg().toBuffer())
      const out: sharp.OverlayOptions[] = [{ input, left, top }]
      if (numbered) out.push({ input: badge(i + 1, badgeSize), left: left + margin, top: top + margin })
      return out
    }),
  )
  return sharp({ create: { width: WIDTH, height: rows * cell + GAP * (rows + 1), channels: 3, background: "#ffffff" } })
    .composite(layers.flat())
    .jpeg({ quality: 85 })
    .toBuffer()
}
