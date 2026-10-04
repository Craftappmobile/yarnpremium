// Server-only: copies of the product videos in Bunny Stream.
//
// Employees keep putting videos into Google Drive (lib/product-videos.ts); the
// catalog sync asks Bunny Stream to fetch each new one from Drive. Bunny
// converts it (any phone's format, iPhone HEVC included) to MP4 that plays
// everywhere, smaller than the original, and serves it from its CDN. The shop
// shows a video once its copy is ready; until then the product has its photos.
//
// Settings: BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY (the library's API
// key) and BUNNY_STREAM_CDN_HOST (its CDN hostname, vz-….b-cdn.net). The
// library needs «MP4 fallback» on: the shop plays MP4 files, not HLS playlists.
//
// Redis key catalog:bunny  hash  Drive file id -> BunnyCopy JSON

import { redis } from "@/lib/redis"

const API = "https://video.bunnycdn.com"
const KEY_COPIES = "catalog:bunny"

/** New copies requested per sync, so a big first batch doesn't hold up the catalog. */
const REQUESTS_PER_SYNC = 15
/** A copy that failed is asked for again after this long. */
const RETRY_MS = 24 * 3600_000
/** MP4 fallback files go up to 720p; the largest one at most this tall is played. */
const MAX_MP4 = 720

/** Bunny's video statuses: 4 finished; 5 and 6 failed; the rest are on the way. */
const FINISHED = 4
const FAILED = [5, 6]

export interface BunnyCopy {
  guid: string
  state: "processing" | "ready" | "failed"
  requestedAt: number
  /** When ready: the MP4 played, e.g. "play_720p.mp4", and the frame shown before it starts. */
  file?: string
  thumbnail?: string
  /** Seconds, from Bunny. */
  length?: number
}

/** What the product page needs to play a ready copy. */
export interface BunnyRef {
  guid: string
  file: string
  thumbnail: string
  length: number
}

interface BunnyVideo {
  guid: string
  title: string
  status: number
  length: number
  availableResolutions: string | null
  hasMP4Fallback: boolean
  thumbnailFileName: string | null
}

const library = () => process.env.BUNNY_STREAM_LIBRARY_ID ?? ""
const cdnHost = () => (process.env.BUNNY_STREAM_CDN_HOST ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "")

export function bunnyConfigured(): boolean {
  return Boolean(library() && process.env.BUNNY_STREAM_API_KEY && cdnHost())
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/library/${encodeURIComponent(library())}${path}`, {
    method,
    headers: {
      AccessKey: process.env.BUNNY_STREAM_API_KEY ?? "",
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Bunny Stream ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json().catch(() => ({}))) as T
}

async function listLibrary(): Promise<Map<string, BunnyVideo>> {
  const videos = new Map<string, BunnyVideo>()
  for (let page = 1; ; page++) {
    const res = await api<{ totalItems: number; items: BunnyVideo[] }>("GET", `/videos?page=${page}&itemsPerPage=100`)
    for (const v of res.items ?? []) videos.set(v.guid, v)
    if (!res.items?.length || videos.size >= res.totalItems) return videos
  }
}

/** The largest MP4 fallback file not taller than MAX_MP4, e.g. "play_720p.mp4". */
function mp4File(v: BunnyVideo): string | undefined {
  if (!v.hasMP4Fallback) return undefined
  const heights = (v.availableResolutions ?? "")
    .split(",")
    .map((r) => Number.parseInt(r, 10))
    .filter((h) => h > 0 && h <= MAX_MP4)
  return heights.length ? `play_${Math.max(...heights)}p.mp4` : undefined
}

export interface BunnyWanted {
  /** Drive file id. */
  id: string
  /** Shown as the title in Bunny's dashboard, e.g. «MER1124 · огляд». */
  title: string
  /** Where Bunny fetches the file from. */
  url: string
}

export interface BunnyReport {
  ready: number
  processing: number
  failed: number
  requested: number
  deleted: number
  /** Copies finished without MP4 files: «MP4 fallback» is off in the library. */
  noMp4: number
}

/**
 * Makes sure every wanted video has a copy in Bunny Stream: asks for the new
 * ones, follows those being converted, removes copies no longer wanted (a
 * video re-shot, a product gone). Returns the ready copies by Drive file id.
 */
export async function syncBunnyCopies(wanted: BunnyWanted[]): Promise<{ ready: Map<string, BunnyRef>; report: BunnyReport }> {
  const r = await redis()
  const stored = await r.hGetAll(KEY_COPIES)
  const copies = new Map(Object.entries(stored).map(([id, json]) => [id, JSON.parse(json) as BunnyCopy]))
  const inLibrary = await listLibrary()
  const report: BunnyReport = { ready: 0, processing: 0, failed: 0, requested: 0, deleted: 0, noMp4: 0 }
  const ready = new Map<string, BunnyRef>()
  const wantedIds = new Set(wanted.map((w) => w.id))
  let requests = 0

  for (const w of wanted) {
    let copy = copies.get(w.id)
    const video = copy && inLibrary.get(copy.guid)
    if (copy && video) {
      if (video.status === FINISHED) {
        const file = mp4File(video)
        if (!file) report.noMp4++
        copy = {
          ...copy,
          state: file ? "ready" : "processing",
          file,
          thumbnail: video.thumbnailFileName || "thumbnail.jpg",
          length: video.length,
        }
      } else if (FAILED.includes(video.status)) copy = { ...copy, state: "failed" }
      else copy = { ...copy, state: "processing" }
    }
    // Never asked for, deleted in Bunny's dashboard, or failed a day ago: ask (again).
    const retry = copy?.state === "failed" && Date.now() - copy.requestedAt > RETRY_MS
    if ((!copy || !video || retry) && requests < REQUESTS_PER_SYNC) {
      requests++
      if (copy && video) await api("DELETE", `/videos/${copy.guid}`).catch(() => {})
      try {
        const created = await api<{ guid: string }>("POST", "/videos", { title: w.title })
        await api("POST", `/videos/${created.guid}/fetch`, { url: w.url })
        copy = { guid: created.guid, state: "processing", requestedAt: Date.now() }
        report.requested++
      } catch (e) {
        console.error("[bunny]", (e as Error).message)
        copy = undefined
      }
    }
    if (!copy) continue
    copies.set(w.id, copy)
    report[copy.state]++
    if (copy.state === "ready" && copy.file) {
      ready.set(w.id, { guid: copy.guid, file: copy.file, thumbnail: copy.thumbnail ?? "thumbnail.jpg", length: copy.length ?? 0 })
    }
  }

  for (const [id, copy] of copies) {
    if (wantedIds.has(id)) continue
    if (inLibrary.has(copy.guid)) {
      const gone = await api("DELETE", `/videos/${copy.guid}`).then(
        () => true,
        (e: Error) => (console.error("[bunny]", e.message), false),
      )
      if (!gone) continue
      report.deleted++
    }
    copies.delete(id)
  }

  const tx = r.multi().del(KEY_COPIES)
  if (copies.size) tx.hSet(KEY_COPIES, Object.fromEntries([...copies].map(([id, c]) => [id, JSON.stringify(c)])))
  await tx.exec()
  return { ready, report }
}

/** Playback and poster addresses of a ready copy on Bunny's CDN. */
export function bunnyUrls(ref: BunnyRef): { src: string; poster: string } {
  const base = `https://${cdnHost()}/${encodeURIComponent(ref.guid)}`
  return { src: `${base}/${ref.file}`, poster: `${base}/${ref.thumbnail}` }
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const readyCache = new Map<string, { at: number; urls: { src: string; poster: string } | null }>()

/**
 * A video uploaded to the library by hand (an ad, say): its MP4 and first
 * frame once Bunny has finished it, or null. `ref` is its id, any Bunny link
 * that contains it, or its title as Bunny shows it (the newest finished video
 * whose title contains it). Asked again at most every 10 minutes.
 */
export async function libraryVideo(ref: string): Promise<{ src: string; poster: string } | null> {
  const key = ref.trim().toLowerCase()
  if (!key || !bunnyConfigured()) return null
  const cached = readyCache.get(key)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.urls
  let urls: { src: string; poster: string } | null = null
  try {
    const guid = ref.match(GUID)?.[0]?.toLowerCase()
    const video = guid ? await api<BunnyVideo>("GET", `/videos/${guid}`) : await findByTitle(ref.trim())
    const file = video && video.status === FINISHED ? mp4File(video) : undefined
    if (video && file) {
      urls = bunnyUrls({ guid: video.guid, file, thumbnail: video.thumbnailFileName || "thumbnail.jpg", length: video.length })
    }
  } catch (e) {
    console.error("[bunny] library video:", (e as Error).message)
  }
  readyCache.set(key, { at: Date.now(), urls })
  return urls
}

async function findByTitle(title: string): Promise<BunnyVideo | undefined> {
  const res = await api<{ items: BunnyVideo[] }>(
    "GET",
    `/videos?page=1&itemsPerPage=20&orderBy=date&search=${encodeURIComponent(title)}`,
  )
  const wanted = title.toLowerCase()
  return (res.items ?? []).find((v) => v.status === FINISHED && v.title.toLowerCase().includes(wanted))
}
