import { type NextRequest, NextResponse } from "next/server"
import { countStats } from "@/lib/assistant/stats"

// Daily counters of product video viewers (components/shop/video-attribution.ts
// sends each step once a day per visitor). Only the live site counts.
export const dynamic = "force-dynamic"

const STEPS: Record<string, string> = {
  page: "video_pages",
  start_review: "video_review_started",
  complete_review: "video_review_completed",
  start_sample: "video_sample_started",
  complete_sample: "video_sample_completed",
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { step?: unknown } | null
  const field = typeof body?.step === "string" ? STEPS[body.step] : undefined
  if (!field) return new NextResponse(null, { status: 400 })
  await countStats({ [field]: 1 })
  return new NextResponse(null, { status: 204 })
}
