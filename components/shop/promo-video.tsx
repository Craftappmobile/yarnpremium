"use client"

import { useEffect, useRef, useState } from "react"
import { Volume2, VolumeX } from "lucide-react"

/**
 * The ad's video beside the promotion header, small and playing on its own
 * without sound, like the Reels it came from: someone who tapped the ad sees
 * the same frames. Still for people who ask for less motion; a tap turns the
 * sound on.
 */
export function PromoVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    const video = ref.current
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    video.play().catch(() => {})
  }, [src])

  return (
    <div className="relative aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900 sm:w-32 lg:w-40">
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        aria-label={label}
        className="h-full w-full object-cover"
      />
      <button
        type="button"
        onClick={() => {
          const video = ref.current
          setMuted((m) => !m)
          if (video?.paused) video.play().catch(() => {})
        }}
        aria-label={muted ? "Увімкнути звук" : "Вимкнути звук"}
        className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white"
      >
        {muted ? <VolumeX className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  )
}
