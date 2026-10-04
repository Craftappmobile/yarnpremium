import { readStorage, writeStorage } from "@/lib/storage"

// Product videos and orders: whether those who watched a video to the end buy
// more often than those who didn't. Remembers what this visitor watched in the
// past week, counts each kind of viewer once a day on the server (/api/video-stats),
// and marks the order they place. Cleared once that order is placed.

const KEY = "sinserita:video:v1"
const KEEP_MS = 7 * 86400_000

export type VideoRole = "review" | "sample"
/** page: opened a product page that has a video; start / complete: of the review or the sample. */
export type VideoStep = "page" | `${"start" | "complete"}_${VideoRole}`

/** Sent with an order placed within a week of seeing a product video. */
export interface VideoAttribution {
  /** Opened a product page with a video. */
  page: boolean
  reviewCompleted: boolean
  sampleCompleted: boolean
}

interface Saved {
  last: number
  steps: VideoStep[]
  /** Kyiv day each step was last counted on the server, so a visitor counts once a day. */
  counted: Partial<Record<VideoStep, string>>
}

const kyivDay = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(new Date())

function read(): Saved | null {
  const s = readStorage(KEY) as Saved | null
  if (!s || typeof s.last !== "number" || Date.now() - s.last > KEEP_MS) return null
  return {
    last: s.last,
    steps: Array.isArray(s.steps) ? s.steps.filter((x): x is VideoStep => typeof x === "string") : [],
    counted: s.counted && typeof s.counted === "object" ? s.counted : {},
  }
}

/** Notes a step and counts it on the server, once a day per visitor. */
export function recordVideoStep(step: VideoStep) {
  const s = read() ?? { last: 0, steps: [], counted: {} }
  if (!s.steps.includes(step)) s.steps = [...s.steps, step]
  const today = kyivDay()
  const fresh = s.counted[step] !== today
  s.counted[step] = today
  s.last = Date.now()
  writeStorage(KEY, s)
  if (!fresh) return
  fetch("/api/video-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step }),
    keepalive: true,
  }).catch(() => {})
}

/** What to send with the order, or undefined when the visitor saw no product video this week. */
export function readVideoAttribution(): VideoAttribution | undefined {
  const s = read()
  if (!s || s.steps.length === 0) return undefined
  return {
    page: s.steps.includes("page"),
    reviewCompleted: s.steps.includes("complete_review"),
    sampleCompleted: s.steps.includes("complete_sample"),
  }
}

/** After an order: the next one needs a new video view to count. Today's counting stays, so nobody counts twice. */
export function clearVideoAttribution() {
  const s = read()
  if (s) writeStorage(KEY, { ...s, steps: [] })
}
