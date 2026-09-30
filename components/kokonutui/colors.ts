// Central color dictionary: color name -> HEX swatch.
//
// Products only need to specify a color NAME (the `color` field). The swatch
// HEX is looked up here, so identical color names always render the same
// swatch across the whole catalog — no more drift between similar shades.
//
// To add a new yarn color: add one line below. Keep names canonical (e.g. use
// "Золотий" everywhere, not a mix of "золото"/"Золотий") so they collapse into
// a single filter entry.
export const colorHexMap: Record<string, string> = {
  Black: "#18181b",
  White: "#fafafa",
  Beige: "#d6c7a1",
  Wood: "#a97b4f",
  Gray: "#9ca3af",
  Gold: "#c9a227",
  Terracotta: "#c66a4a",
  Silver: "#c0c0c0",
  // Ukrainian yarn shades — extend this list as new colors arrive in stock.
  "Зелений меланж": "#7a8b5a",
  "Зелено-сірий чай": "#a7b59a",
  "Зеленувато-блакитний": "#1f7a7a",
  Золотий: "#d4af37",
  "Золотистий беж": "#cbb279",
  Золото: "#c9a227",
  Молочний: "#f4ede0",
  Пудра: "#e7c6bd",
  Графіт: "#3f3f46",
  Індиго: "#2b3a67",
  Вишневий: "#7b2233",
  Гірчичний: "#c9a227",
}

// Fallback swatch for any color name not present in the dictionary above.
export const FALLBACK_COLOR_HEX = "#d4d4d8"

/** Resolve a color name to its swatch HEX, with a neutral fallback. */
export function getColorHex(name: string): string {
  return colorHexMap[name] ?? FALLBACK_COLOR_HEX
}
