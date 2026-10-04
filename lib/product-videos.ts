// Server-only: product videos kept in Google Drive.
//
// An employee drops a video into one of two Drive folders and names the file
// after the product's SKU (the extension is ignored):
//   GOOGLE_DRIVE_REVIEW_FOLDER   video review of the cone      «MER1124.mp4»
//   GOOGLE_DRIVE_SAMPLE_FOLDER   the knitted sample            «MER1124.mov»
// The file's description in Drive, if any, is shown as the caption
// («Зразок у 2 нитки · спиці 3 мм»). Both folders are shared "anyone with the
// link can view", so GOOGLE_DRIVE_API_KEY can list them and fetch the files.
//
// The catalog sync lists both folders and keeps the matches in Redis
// (catalog:videos, sku -> StoredVideos JSON); a product without a match simply
// has no video on its page. When Bunny Stream is set up (lib/bunny-stream.ts),
// the sync copies each video there and the site plays the copy; Drive serves
// a video only until its copy is ready.

import { redis, redisConfigured } from "@/lib/redis"
import { type BunnyRef, type BunnyReport, bunnyConfigured, bunnyUrls, syncBunnyCopies } from "@/lib/bunny-stream"

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
  /** The ready copy in Bunny Stream, played instead of the Drive file. */
  bunny?: BunnyRef
}

interface StoredVideos {
  review?: StoredVideo
  sample?: StoredVideo
}

export interface ProductVideo extends StoredVideo {
  src: string
  /** A frame of the video, full size and for the thumbnail strip. Drive may have none for a fresh upload. */
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
  /** Copies in Bunny Stream, or why they couldn't be updated (videos then play from Drive). */
  bunny?: BunnyReport | { error: string }
}

const driveFileUrl = (id: string) => `${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(apiKey())}`

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

  if (bunnyConfigured()) {
    const ROLE_TITLE = { review: "огляд", sample: "зразок" }
    const wanted = [...videos].flatMap(([sku, entry]) =>
      (["review", "sample"] as const).flatMap((role) => {
        const v = entry[role]
        return v ? [{ id: v.id, title: `${sku} · ${ROLE_TITLE[role]}`, url: driveFileUrl(v.id) }] : []
      }),
    )
    try {
      const { ready, report: bunny } = await syncBunnyCopies(wanted)
      for (const entry of videos.values()) {
        for (const v of [entry.review, entry.sample]) {
          const copy = v && ready.get(v.id)
          if (!copy) continue
          v.bunny = copy
          if (!v.durationMs && copy.length) v.durationMs = Math.round(copy.length * 1000)
        }
      }
      report.bunny = bunny
    } catch (e) {
      report.bunny = { error: (e as Error).message }
      // Bunny unreachable for a moment: the copies already ready keep playing.
      const before = await (await redis()).hGetAll(KEY_VIDEOS).catch(() => ({}) as Record<string, string>)
      const known = new Map<string, BunnyRef>()
      for (const raw of Object.values(before)) {
        const old = JSON.parse(raw) as StoredVideos
        for (const v of [old.review, old.sample]) if (v?.bunny) known.set(v.id, v.bunny)
      }
      for (const entry of videos.values()) {
        for (const v of [entry.review, entry.sample]) if (v && known.has(v.id)) v.bunny = known.get(v.id)
      }
    }
  }
  return { videos, report }
}

function withUrls(v: StoredVideo | undefined): ProductVideo | undefined {
  if (!v) return undefined
  // Bunny's copy: converted to MP4 that plays on every phone, from a CDN.
  if (v.bunny && bunnyConfigured()) {
    const { src, poster } = bunnyUrls(v.bunny)
    return { ...v, src, poster, thumb: poster }
  }
  const id = encodeURIComponent(v.id)
  return {
    ...v,
    // Drive serves the file itself with range requests, so the video can start before it's all loaded.
    src: driveFileUrl(v.id),
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
