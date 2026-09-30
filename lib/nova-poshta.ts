// Server-only Nova Poshta API client. The API key is read from the environment
// and never sent to the browser.

const NP_URL = "https://api.novaposhta.ua/v2.0/json/"

export function npConfigured(): boolean {
  return Boolean(process.env.NOVA_POSHTA_API_KEY)
}

/** Calls a Nova Poshta API method and returns its `data` array. Throws on transport or API errors. */
export async function npCall<T = any>(
  modelName: string,
  calledMethod: string,
  methodProperties: Record<string, string>,
): Promise<T[]> {
  const res = await fetch(NP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: process.env.NOVA_POSHTA_API_KEY, modelName, calledMethod, methodProperties }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Nova Poshta HTTP ${res.status}`)
  const json = await res.json()
  if (json?.success === false) throw new Error(`Nova Poshta: ${(json.errors ?? []).join("; ")}`)
  return (json?.data ?? []) as T[]
}

/** Trims and bounds user input before it is forwarded to the API. */
export function cleanQuery(value: unknown, max = 100): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}
