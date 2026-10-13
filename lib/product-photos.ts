// Server-only: extra product photos kept in Google Drive.
//
// An employee drops a photo into GOOGLE_DRIVE_PHOTO_FOLDER and names it after
// the product's SKU, with a number when there are several; the number sets
// their order (a photo without one comes first):
//   «MER1124.jpg»  «MER1124 2.jpg»  «MER1124-3.png»  «MER1124 (4).heic»
// The catalog sync lists the folder and puts the photos in the product's
// gallery after the ones from KeyCRM (lib/catalog.ts). The shop serves them
// from its own domain (app/drive-img), so the API key never leaves the server.
//
// Redis key catalog:photos  hash  Drive file id -> its path on the shop
// (the photos the last sync found; app/drive-img serves only these)

import { redis, redisConfigured } from "@/lib/redis"
import { baseName, driveApiKey, folderId, listDriveFolder, skuInName, skuKey } from "@/lib/google-drive"

export const KEY_PHOTOS = "catalog:photos"

/** Where the shop serves a Drive photo. */
export const DRIVE_IMG_PATH = "/drive-img/"

const folder = () => folderId(process.env.GOOGLE_DRIVE_PHOTO_FOLDER)

export function drivePhotosConfigured(): boolean {
  return Boolean(driveApiKey() && folder())
}

interface DriveFile {
  id: string
  name: string
  modifiedTime?: string
}

export interface DrivePhotoReport {
  photos: number
  products: number
  /** File names that match no SKU on sale: a typo, or a product that's gone. */
  unmatched: string[]
}

/** «MER1124 2», «MER1124-2», «MER1124_2», «MER1124 (2)», «MER1124(2)»: the name before the number, and the number. */
const NUMBERED = /^(.+?)(?:[\s_-]+\(?|\()(\d{1,2})\)?$/

/**
 * The SKU a photo is named after and its place among the product's photos. A
 * name ending in a number is first read as SKU + number, then as a whole (a
 * SKU that ends in digits after a dash, «AB-12»).
 */
function photoSku(name: string, bySkuKey: Map<string, string>): { sku: string; position: number } | undefined {
  const numbered = name.match(NUMBERED)
  const base = numbered && skuInName(numbered[1], bySkuKey)
  if (base) return { sku: base, position: Number(numbered[2]) }
  const sku = skuInName(name, bySkuKey)
  return sku ? { sku, position: 0 } : undefined
}

/**
 * The photo's path on the shop. It changes when the file does, so a photo
 * replaced in Drive is fetched anew instead of coming from the CDN's copy.
 */
const photoPath = (file: DriveFile) =>
  `${DRIVE_IMG_PATH}${file.id}/${(Date.parse(file.modifiedTime ?? "") || 0).toString(36)}`

/** Photos for the given SKUs, in their order: SKU -> paths on the shop. */
export async function matchDrivePhotos(
  skus: string[],
): Promise<{ photos: Map<string, string[]>; paths: Record<string, string>; report: DrivePhotoReport }> {
  const bySkuKey = new Map(skus.map((sku) => [skuKey(sku), sku]))
  const files = await listDriveFolder<DriveFile>(folder(), "image/", "id,name,modifiedTime")
  const found = new Map<string, { position: number; name: string; path: string }[]>()
  const paths: Record<string, string> = {}
  const unmatched: string[] = []
  for (const file of files) {
    const match = photoSku(baseName(file.name).trim(), bySkuKey)
    if (!match) {
      unmatched.push(file.name)
      continue
    }
    const path = photoPath(file)
    paths[file.id] = path
    found.set(match.sku, [...(found.get(match.sku) ?? []), { position: match.position, name: file.name, path }])
  }
  const photos = new Map(
    [...found].map(([sku, list]) => [
      sku,
      list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "uk", { numeric: true })).map((p) => p.path),
    ]),
  )
  return {
    photos,
    paths,
    report: { photos: Object.keys(paths).length, products: photos.size, unmatched: unmatched.slice(0, 100) },
  }
}

/** The path of a photo the last sync found, or null for any other Drive file. */
export async function knownDrivePhoto(id: string): Promise<string | null> {
  if (!redisConfigured()) return null
  return (await (await redis()).hGet(KEY_PHOTOS, id)) ?? null
}
