// Server-only: product videos kept in Google Drive.
//
// An employee drops a video into one of two Drive folders and names the file
// after the product's SKU (the extension is ignored):
//   GOOGLE_DRIVE_REVIEW_FOLDER   video review of the cone      «MER1124.mp4»
//   GOOGLE_DRIVE_SAMPLE_FOLDER   the knitted sample            «MER1124.mov»
// The file's description in Drive, if any, is shown as the caption
// («Зразок у 2 нитки · спиці 3 мм»). Both folders are shared "anyone with the
// link can view", so GOOGLE_DRIVE_API_KEY can list them and the browser can
// play the files straight from Drive.
//
// The catalog sync lists both folders and keeps the matches in Redis
// (catalog:videos, sku -> StoredVideos JSON); a product without a match simply
// has no video on its page.

import { redis, redisConfigured } from "@/lib/redis"

export const KEY_VIDEOS = "catalog:videos"

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"

interface StoredVideo {
  /** Drive file id. */
  id: string
  /** 0 while Drive is still processing a fresh upload. */
  durationMs: number
  width: number
  height: number
  caption: string
}

interface StoredVideos {
  review?: StoredVideo
  sample?: StoredVideo
}

export interface ProductVideo extends StoredVideo {
  src: string
  /** A frame from Drive, full size and for the thumbnail strip. May be missing for a fresh upload. */
  poster: string
  thumb: string
}

export interface ProductVideos {
  review?: ProductVideo
  sample?: ProductVideo
}

const apiKey = () => process.env.GOOGLE_DRIVE_API_KEY ?? ""

/** Accepts the folder id or the whole link copied from Drive. */
function folderId(value: string | undefined): string {
  const v = (value ?? "").trim()
  return v.match(/\/folders\/([\w-]+)/)?.[1] ?? v
}

const folders = () => ({
  review: folderId(process.env.GOOGLE_DRIVE_REVIEW_FOLDER),
  sample: folderId(process.env.GOOGLE_DRIVE_SAMPLE_FOLDER),
})

export function driveVideosConfigured(): boolean {
  const f = folders()
  return Boolean(apiKey() && (f.review || f.sample))
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

interface DriveFile {
  id: string
  name: string
  description?: string
  modifiedTime?: string
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string }
}

async function listFolder(folder: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken = ""
  do {
    const url = new URL(DRIVE_FILES)
    url.search = new URLSearchParams({
      q: `'${folder}' in parents and trashed = false and mimeType contains 'video/'`,
      fields: "nextPageToken,files(id,name,description,modifiedTime,videoMediaMetadata(width,height,durationMillis))",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      key: apiKey(),
      ...(pageToken ? { pageToken } : {}),
    }).toString()
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string }
    files.push(...(body.files ?? []))
    pageToken = body.nextPageToken ?? ""
  } while (pageToken)
  return files
}

export interface DriveVideoReport {
  review: number
  sample: number
  /** File names that match no SKU on sale: a typo, or a product that's gone. */
  unmatched: string[]
}

/**
 * Videos for the given SKUs, read from both Drive folders. Where a folder holds
 * several files for one SKU, the most recently changed one wins (a re-shot video).
 */
export async function matchDriveVideos(skus: string[]): Promise<{ videos: Map<string, StoredVideos>; report: DriveVideoReport }> {
  const bySkuKey = new Map(skus.map((sku) => [skuKey(sku), sku]))
  const videos = new Map<string, StoredVideos>()
  const report: DriveVideoReport = { review: 0, sample: 0, unmatched: [] }
  const f = folders()
  const lists = await Promise.all([f.review ? listFolder(f.review) : [], f.sample ? listFolder(f.sample) : []])

  ;(["review", "sample"] as const).forEach((role, i) => {
    const newestFirst = [...lists[i]].sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""))
    for (const file of newestFirst) {
      const sku = bySkuKey.get(skuKey(file.name.replace(/\.[^.]+$/, "")))
      if (!sku) {
        report.unmatched.push(file.name)
        continue
      }
      const entry = videos.get(sku) ?? {}
      if (entry[role]) continue
      const meta = file.videoMediaMetadata ?? {}
      entry[role] = {
        id: file.id,
        durationMs: Number(meta.durationMillis ?? 0) || 0,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        caption: (file.description ?? "").trim().slice(0, 200),
      }
      videos.set(sku, entry)
      report[role]++
    }
  })
  report.unmatched = report.unmatched.slice(0, 100)
  return { videos, report }
}

function withUrls(v: StoredVideo | undefined): ProductVideo | undefined {
  if (!v) return undefined
  const id = encodeURIComponent(v.id)
  return {
    ...v,
    // Drive serves the file itself with range requests, so the video can start before it's all loaded.
    src: `${DRIVE_FILES}/${id}?alt=media&key=${encodeURIComponent(apiKey())}`,
    poster: `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
    thumb: `https://drive.google.com/thumbnail?id=${id}&sz=w200`,
  }
}

function toVideos(raw: string | null | undefined): ProductVideos | null {
  if (!raw) return null
  const stored = JSON.parse(raw) as StoredVideos
  const videos = { review: withUrls(stored.review), sample: withUrls(stored.sample) }
  return videos.review || videos.sample ? videos : null
}

/** The product's videos, or null when it has none. */
export async function readProductVideos(sku: string): Promise<ProductVideos | null> {
  if (!redisConfigured() || !apiKey()) return null
  return toVideos(await (await redis()).hGet(KEY_VIDEOS, sku))
}

/** Videos of every product that has any, by SKU (for the Meta catalog feed). */
export async function readAllProductVideos(): Promise<Map<string, ProductVideos>> {
  if (!redisConfigured() || !apiKey()) return new Map()
  const all = await (await redis()).hGetAll(KEY_VIDEOS)
  return new Map(
    Object.entries(all).flatMap(([sku, raw]) => {
      const videos = toVideos(raw)
      return videos ? [[sku, videos] as const] : []
    }),
  )
}
