// Server-only client for the Ukrposhta address classifier (address-classifier-ws).
// The bearer token is read from the environment and never sent to the browser.

const UP_URL = (process.env.UKRPOSHTA_ADDRESS_API_URL || "https://www.ukrposhta.ua/address-classifier-ws").replace(
  /\/+$/,
  "",
)

export function upConfigured(): boolean {
  return Boolean(process.env.UKRPOSHTA_BEARER)
}

export type UpEntry = Record<string, string | number | null | undefined>

/** Calls a classifier method and returns its `Entries.Entry` list. Throws on transport errors. */
export async function upGet(method: string, params: Record<string, string>): Promise<UpEntry[]> {
  const url = new URL(`${UP_URL}/${method}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${process.env.UKRPOSHTA_BEARER}` },
    // The classifier changes rarely; cache lookups for a day.
    next: { revalidate: 86400 },
  })
  if (!res.ok) throw new Error(`Ukrposhta HTTP ${res.status}`)
  const json = await res.json()
  // A single match comes back as an object rather than a one-item array.
  const entry = json?.Entries?.Entry
  return Array.isArray(entry) ? entry : entry ? [entry] : []
}

/** Reads a classifier field as a trimmed string ("" when missing). */
export function field(entry: UpEntry, ...keys: string[]): string {
  for (const key of keys) {
    const value = entry[key]
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim()
  }
  return ""
}
