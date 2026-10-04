// Colour of a yarn, worked out from its photo during the catalog sync, its
// colour group (from the colour's name in KeyCRM, else the photo), and the
// colour filter built on them: 15 colour groups plus a hue wheel for a precise
// shade. Everything is in OKLCH, where equal steps look equally different.

export type ColorFamily =
  | "red"
  | "burgundy"
  | "pink"
  | "orange"
  | "yellow"
  | "green"
  | "turquoise"
  | "blue"
  | "violet"
  | "brown"
  | "beige"
  | "grey"
  | "black"
  | "white"
  | "multi"

export const COLOR_FAMILIES: { id: ColorFamily; label: string; swatch: string }[] = [
  { id: "red", label: "Червоний", swatch: "#d0312d" },
  { id: "burgundy", label: "Бордо", swatch: "#7a1f30" },
  { id: "pink", label: "Рожевий", swatch: "#eea2bf" },
  { id: "orange", label: "Помаранчевий", swatch: "#ec8a2f" },
  { id: "yellow", label: "Жовтий", swatch: "#eccb4a" },
  { id: "green", label: "Зелений", swatch: "#4f9150" },
  { id: "turquoise", label: "Бірюзовий", swatch: "#239f9a" },
  { id: "blue", label: "Синій", swatch: "#3a64b4" },
  { id: "violet", label: "Фіолетовий", swatch: "#7c55ad" },
  { id: "brown", label: "Коричневий", swatch: "#6b4a38" },
  { id: "beige", label: "Бежевий", swatch: "#d8c4a4" },
  { id: "grey", label: "Сірий", swatch: "#9a9a9a" },
  { id: "black", label: "Чорний", swatch: "#1e1e1e" },
  { id: "white", label: "Білий", swatch: "#f6f4ee" },
  { id: "multi", label: "Мультиколор", swatch: "" },
]

export interface Oklch {
  /** Lightness 0–1. */
  l: number
  /** Chroma, ~0–0.37 in sRGB. */
  c: number
  /** Hue in degrees, 0–360. */
  h: number
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** sRGB 0–255 → OKLab. */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = toLinear(r / 255)
  const lg = toLinear(g / 255)
  const lb = toLinear(b / 255)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToOklch([l, a, b]: [number, number, number]): Oklch {
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h }
}

function oklabToRgb(l: number, a: number, b: number): [number, number, number] {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

/** OKLCH → "#rrggbb", lowering chroma until the colour fits in sRGB. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180
  let chroma = c
  let rgb = oklabToRgb(l, chroma * Math.cos(rad), chroma * Math.sin(rad))
  while (chroma > 0 && rgb.some((v) => v < -0.0005 || v > 1.0005)) {
    chroma = Math.max(0, chroma - 0.005)
    rgb = oklabToRgb(l, chroma * Math.cos(rad), chroma * Math.sin(rad))
  }
  return (
    "#" +
    rgb
      .map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0"))
      .join("")
  )
}

export function hexToOklab(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

export function hexToOklch(hex: string): Oklch | null {
  const lab = hexToOklab(hex)
  return lab && oklabToOklch(lab)
}

/**
 * How different two colours look: hue, lightness and saturation together
 * (OKLab distance). About 0.02 is barely visible, 0.1 a clearly other shade.
 */
export function colorDistance(a: string, b: string): number | null {
  const x = hexToOklab(a)
  const y = hexToOklab(b)
  return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : null
}

/** Which of the colour groups a single colour belongs to. */
export function classifyColor({ l, c, h }: Oklch): Exclude<ColorFamily, "multi"> {
  // Dark browns carry very little colour; don't let them fall into grey.
  if (c >= 0.013 && c < 0.035 && h >= 15 && h < 100 && l >= 0.25 && l < 0.55) return "brown"
  // Neutrals first: too little colour to have a hue worth naming.
  if (c < 0.035) {
    if (l < 0.3) return "black"
    if (l > 0.9) return "white"
    // Faintly warm light neutrals read as beige (cream, ecru, oatmeal).
    if (c >= 0.02 && h >= 40 && h <= 110 && l > 0.7) return "beige"
    return "grey"
  }
  if (l < 0.22) return "black"
  const warm = h >= 30 && h < 110
  if (warm && c < 0.09 && l > 0.7) return "beige"
  if (warm && h < 85 && l < 0.55) return "brown"
  // Olive and khaki: yellowish but dark.
  if (h >= 85 && h < 115 && l < 0.55) return "green"
  if (h >= 345 || h < 30) {
    if (l < 0.45) return "burgundy"
    if (l > 0.75) return "pink"
    return "red"
  }
  if (h < 70) return "orange"
  if (h < 115) return "yellow"
  if (h < 180) return "green"
  if (h < 225) return "turquoise"
  if (h < 285) return "blue"
  if (h < 325) return l > 0.75 ? "pink" : "violet"
  return l < 0.45 ? "burgundy" : "pink"
}

// Colour names from KeyCRM («Колір»), typed by the shop, are a surer guide to
// the group than the photo: photos come out darker and greyer than the yarn,
// which sent pinks to red and light beiges to grey. A name decides by its last
// colour word: «сіро-бежевий» is beige, «оливково-зелений» green, «темно-синій
// меланж» blue. Words are matched by their start.
const NAME_STEMS: [Exclude<ColorFamily, "multi">, string[]][] = [
  ["black", ["чорний", "чорна", "чорне", "чорні", "чорно"]],
  ["white", ["біл", "молочн", "молочнй", "екрю", "айворі", "кістк", "вершк", "ваніл", "крем", "перлин"]],
  ["grey", ["сір", "графіт", "антрацит", "срібн", "срібля", "попіл", "асфальт", "сталь", "сталев"]],
  ["beige", ["беж", "кемел", "кемл", "пісок", "пісоч", "мигдал", "лате", "капучин", "капучін", "шампань", "глин", "пшенич", "брюле"]],
  ["brown", ["коричн", "шоколад", "шоколвд", "кава", "кавов", "какао", "мокко", "горіх", "каштан", "трюфел", "кориц", "сепі", "тауп", "карамел", "праліне"]],
  ["pink", ["рожев", "фукс", "малин", "пудр", "троянд", "барбі", "цикламен", "амарант", "кавун", "цукров"]],
  ["red", ["червон", "томат", "цегл", "калин", "шипшин"]],
  ["burgundy", ["бордо", "бордов", "бургунді", "марсал", "вин", "вишн", "ягід", "ягод"]],
  ["orange", ["помаранч", "оранж", "апельсин", "морк", "гарбуз", "руд", "теракот", "терракот", "мідн", "абрикос", "корал", "персик", "бронз"]],
  ["yellow", ["жовт", "лимон", "гірчи", "вохр", "соняш", "золот", "масл", "ананас"]],
  ["green", ["зелен", "олив", "хакі", "хаккі", "полин", "хво", "смарагд", "салат", "лайм", "фісташ", "м'ят", "мят", "шавлі", "трав", "спарж", "ментол"]],
  ["turquoise", ["бірюз", "хвил", "тіффані", "петрол"]],
  ["blue", ["син", "блакит", "блакийт", "джин", "денім", "волошк", "електрик", "лазур", "небес", "сапфір", "кобальт", "індиго", "наві", "чорнил"]],
  ["violet", ["фіолет", "бузк", "бузок", "лаванд", "виноград", "слив", "баклажан", "орхіде", "інжир", "аметист"]],
]

/** Whole names whose last colour word misleads. */
const NAME_EXCEPTIONS: Record<string, ColorFamily> = {
  "кава з молоком": "beige",
  "пряжене молоко": "beige",
  "малина у вершках": "pink",
  "слива в шоколаді": "violet",
  "рожеве золото": "pink",
  "синя сталь": "blue",
  "рожеві на білій основі": "pink",
  "морська хвиля": "turquoise",
  "чорний із золотом": "black",
  "світло-сірий з блакитним підтоном меланж": "grey",
}

const MULTI_COLOR_NAME = /мультикол|різнокол|градієнт|^rgb$/

/** The colour group a KeyCRM colour name points to; null when no colour word is recognised. */
export function familyFromName(name: string): ColorFamily | null {
  const n = name
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^\d+\s*-?\s*/, "")
    .trim()
  if (!n) return null
  if (MULTI_COLOR_NAME.test(n)) return "multi"
  if (NAME_EXCEPTIONS[n]) return NAME_EXCEPTIONS[n]
  const words = n.split(/[\s\-–—,/]+/).filter(Boolean)
  for (let i = words.length - 1; i >= 0; i--) {
    for (const [family, stems] of NAME_STEMS) if (stems.some((s) => words[i].startsWith(s))) return family
  }
  return null
}

/** A point picked on the hue wheel, optionally narrowed by the lightness slider. */
export interface Shade {
  h: number
  /** null until the slider is touched: then any lightness of the hue matches. */
  l: number | null
}

/** Lightness used to draw a shade when none is picked. */
const SHOW_L = 0.6

/** The colour shown for a picked shade (wheel marker, swatch). */
export const shadeHex = ({ h, l }: Shade) => oklchToHex({ l: l ?? SHOW_L, c: 0.14, h })

export const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

type WheelFamily = "pink" | "red" | "orange" | "yellow" | "green" | "turquoise" | "blue" | "violet"

/** Where each colour group starts on the wheel as it is drawn (clockwise); pink runs on past 0° to red. */
const WHEEL: [from: number, family: WheelFamily][] = [
  [18, "red"],
  [45, "orange"],
  [75, "yellow"],
  [110, "green"],
  [170, "turquoise"],
  [230, "blue"],
  [285, "violet"],
  [330, "pink"],
]

function wheelFamily(h: number): WheelFamily {
  const deg = ((h % 360) + 360) % 360
  let family: WheelFamily = "pink"
  for (const [from, f] of WHEEL) if (deg >= from) family = f
  return family
}

/**
 * Groups a picked hue may show: its own, and its neighbour's when the pick is
 * near the border. Burgundy is dark red. Photo hues of pinks and reds overlap,
 * so without this a pink pick filled up with red yarn.
 */
function shadeFamilies(h: number): Set<ColorFamily> {
  const out = new Set<ColorFamily>()
  for (const d of [-5, 0, 5]) {
    const f = wheelFamily(h + d)
    out.add(f)
    if (f === "red") out.add("burgundy")
  }
  return out
}

/**
 * Photos come out darker and flatter than the yarn: white yarn reads about 0.64,
 * black 0.32. Stretched back to how the yarn looks, to compare with the slider.
 */
const yarnLightness = (photoL: number) => Math.min(1, Math.max(0, 2.34 * photoL - 0.55))

/** Whether a yarn is close to the shade picked on the wheel. */
export function matchesShade(p: { colorHex?: string; colorFamily?: ColorFamily }, shade: Shade): boolean {
  // Multicoloured yarn has no single shade; grey, black, white, beige and brown aren't on the wheel.
  if (!p.colorHex || p.colorFamily === "multi") return false
  if (p.colorFamily && !shadeFamilies(shade.h).has(p.colorFamily)) return false
  const color = hexToOklch(p.colorHex)
  if (!color) return false
  // A greyish photo has no hue worth trusting: then the group from the colour's name is enough.
  if (color.c >= 0.03) {
    if (hueDistance(color.h, shade.h) > 25) return false
  } else if (!p.colorFamily) return false
  return shade.l === null || Math.abs(yarnLightness(color.l) - shade.l) <= 0.15
}

/** How far a yarn's photo hue is from the picked one, to show the closest first. */
export function shadeOrder(p: { colorHex?: string }, shade: Shade): number {
  const color = p.colorHex ? hexToOklch(p.colorHex) : null
  if (!color || color.c < 0.03) return 180
  return hueDistance(color.h, shade.h) + (shade.l === null ? 0 : Math.abs(yarnLightness(color.l) - shade.l) * 100)
}

/** Name of the group under a point on the wheel, as people would call it. */
export function hueName(shade: Shade): string {
  const f = wheelFamily(shade.h)
  const family = f === "red" && shade.l !== null && shade.l < 0.45 ? "burgundy" : f
  return COLOR_FAMILIES.find((c) => c.id === family)?.label ?? ""
}
