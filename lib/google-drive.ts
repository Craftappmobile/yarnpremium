// Server-only: reading the shared Google Drive folders employees put product
// media into (videos: lib/product-videos.ts, photos: lib/product-photos.ts).
// Each folder is shared "anyone with the link can view", so GOOGLE_DRIVE_API_KEY
// can list it and fetch the files. Files are named after the product's SKU.

export const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"

export const driveApiKey = () => process.env.GOOGLE_DRIVE_API_KEY ?? ""

/** Accepts the folder id or the whole link copied from Drive. */
export function folderId(value: string | undefined): string {
  const v = (value ?? "").trim()
  return v.match(/\/folders\/([\w-]+)/)?.[1] ?? v
}

/** Cyrillic letters typed in place of the Latin ones they look like (МЕR → MER). */
const LOOKALIKES: Record<string, string> = {
  а: "a", в: "b", е: "e", і: "i", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
}

/** SKU or file name as compared: case, spaces, dashes and Cyrillic lookalikes don't matter. */
export function skuKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[авеікмнорстух]/g, (c) => LOOKALIKES[c])
}

/**
 * The SKU a file is named after. The name may carry other words too
 * («спиці MER1124», «MER 1124 зразок»): then the longest run of words that
 * makes a SKU wins.
 */
export function skuInName(name: string, bySkuKey: Map<string, string>): string | undefined {
  const exact = bySkuKey.get(skuKey(name))
  if (exact) return exact
  const words = name.split(/[\s_+.,;:()[\]#№-]+/).filter(Boolean)
  let best: string | undefined
  let bestLength = 0
  for (let i = 0; i < words.length; i++) {
    // SKUs written with spaces span a few words at most.
    for (let j = i + 1; j <= Math.min(words.length, i + 4); j++) {
      const key = skuKey(words.slice(i, j).join(""))
      const sku = bySkuKey.get(key)
      if (sku && key.length > bestLength) {
        best = sku
        bestLength = key.length
      }
    }
  }
  return best
}

/** File name without its extension. */
export const baseName = (name: string) => name.replace(/\.[^.]+$/, "")

/** Every file of the given kind ("video/", "image/") in the folder, with the fields asked for. */
export async function listDriveFolder<T>(folder: string, mimePrefix: string, fileFields: string): Promise<T[]> {
  const files: T[] = []
  let pageToken = ""
  do {
    const url = new URL(DRIVE_FILES)
    url.search = new URLSearchParams({
      q: `'${folder}' in parents and trashed = false and mimeType contains '${mimePrefix}'`,
      fields: `nextPageToken,files(${fileFields})`,
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      key: driveApiKey(),
      ...(pageToken ? { pageToken } : {}),
    }).toString()
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body = (await res.json()) as { files?: T[]; nextPageToken?: string }
    files.push(...(body.files ?? []))
    pageToken = body.nextPageToken ?? ""
  } while (pageToken)
  return files
}

/** The file's content (public files only, which every file in our folders is). */
export const driveFileUrl = (id: string) =>
  `${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(driveApiKey())}`
