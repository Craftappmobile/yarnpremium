// Server-only: the colour of the yarn in a product photo. Photos are a cone or
// skein on a plain light background, so: shrink the photo, drop the pixels that
// match the background (sampled from the border), group the rest into a few
// colours and keep the biggest group. Several strong, different hues mean a
// multicoloured yarn.

import sharp from "sharp"
import { type ColorFamily, classifyColor, oklabToOklch, oklchToHex, rgbToOklab } from "@/components/shop/yarn-colors"

export interface YarnColor {
  /** Main colour, "#rrggbb". */
  hex: string
  family: ColorFamily
}

type Lab = [number, number, number]

const SIZE = 96
/** Colour scatter (OKLab a/b distance) above which a yarn counts as multicoloured. */
const MULTI_SCATTER = 0.035
const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Yarn colour from raw RGB pixels (row-major, 3 bytes each). Exported for tests. */
export function yarnColorFromPixels(rgb: Uint8Array | Buffer, width: number, height: number): YarnColor | null {
  const lab: Lab[] = []
  const edge: Lab[] = []
  const middle: boolean[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const p = rgbToOklab(rgb[i], rgb[i + 1], rgb[i + 2])
      lab.push(p)
      // The yarn stands in the middle; the top and side edges are background.
      if (y < 3 || ((x < 3 || x >= width - 3) && y < height * 0.6)) edge.push(p)
      middle.push(Math.abs(x - width / 2) < width * 0.35 && Math.abs(y - height / 2) < height * 0.4)
    }
  }
  if (!lab.length) return null

  const bg: Lab = [median(edge.map((p) => p[0])), median(edge.map((p) => p[1])), median(edge.map((p) => p[2]))]
  const bgLight = bg[0] > 0.6 && oklabToOklch(bg).c < 0.05
  const isBackground = (p: Lab) => {
    const { l, c } = oklabToOklch(p)
    return (bgLight && dist(p, bg) < 0.1) || (l > 0.82 && c < 0.035)
  }

  let yarn = lab.filter((p, i) => middle[i] && !isBackground(p))
  // Little left: a white or very light yarn on a light background. Use the very middle.
  if (yarn.length < lab.length * 0.06) {
    yarn = lab.filter((_, i) => {
      const x = i % width
      const y = Math.floor(i / width)
      return Math.abs(x - width / 2) < width * 0.15 && Math.abs(y - height / 2) < height * 0.15
    })
  }

  // Shadows darken a cone and highlights wash it out: average the middle of
  // the lightness range, which is how the yarn reads to the eye.
  const byL = [...yarn].sort((a, b) => a[0] - b[0])
  const from = Math.floor(byL.length * 0.35)
  const band = byL.slice(from, Math.max(Math.floor(byL.length * 0.85), from + 1))
  const mean = [0, 1, 2].map((j) => band.reduce((s, p) => s + p[j], 0) / band.length) as Lab
  const color = oklabToOklch(mean)

  // Multicolour: the clearly coloured pixels scatter widely around their
  // average colour (pink next to orange, blue next to violet…). Neutral pixels
  // are left out so a grey background or white flecks don't count.
  const coloured = yarn.filter((p) => oklabToOklch(p).c >= 0.04)
  let multi = false
  if (coloured.length >= yarn.length * 0.2) {
    const ma = coloured.reduce((s, p) => s + p[1], 0) / coloured.length
    const mb = coloured.reduce((s, p) => s + p[2], 0) / coloured.length
    const scatter = coloured.reduce((s, p) => s + Math.hypot(p[1] - ma, p[2] - mb), 0) / coloured.length
    multi = scatter >= MULTI_SCATTER && scatter / Math.hypot(ma, mb) >= 0.35
  }

  return { hex: oklchToHex(color), family: multi ? "multi" : classifyColor(color) }
}

/** Downloads a product photo and works out its yarn colour. */
export async function yarnColorFromUrl(url: string, signal?: AbortSignal): Promise<YarnColor | null> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`photo ${res.status}`)
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    // Nearest-neighbour keeps the real thread colours instead of blending them.
    .resize(SIZE, SIZE, { fit: "cover", kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return yarnColorFromPixels(data, info.width, info.height)
}
