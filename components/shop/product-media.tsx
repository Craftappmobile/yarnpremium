"use client"

import { useEffect, useRef, useState } from "react"
import { Play, Volume2, VolumeX } from "lucide-react"
import type { ProductVideo, ProductVideos } from "@/lib/product-videos"
import { ProductImage } from "./product-image"

type VideoKey = "review" | "sample"

type Slide = { key: VideoKey; kind: "video"; video: ProductVideo } | { key: string; kind: "image"; src: string }

/** In the thumbnail strip, and on the video itself. */
const THUMB_LABEL: Record<VideoKey, string> = { review: "Пряжа", sample: "Зразок" }
const BADGE: Record<VideoKey, string> = { review: "Відеоогляд", sample: "Зразок" }

/** 75 -> "1:15". */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

/**
 * What the product's gallery shows: the cone's video review, the sample video,
 * then the photos. A video that is missing or won't play is left out, so a
 * product without videos keeps the plain photo gallery.
 */
export function useProductMedia(images: string[], videos: ProductVideos | null) {
  const [broken, setBroken] = useState<VideoKey[]>([])
  const slides: Slide[] = [
    ...(["review", "sample"] as const).flatMap((key): Slide[] => {
      const video = videos?.[key]
      return video && !broken.includes(key) ? [{ key, kind: "video", video }] : []
    }),
    ...images.map((src, i): Slide => ({ key: `photo-${i}`, kind: "image", src })),
  ]
  const [shown, setShown] = useState({ key: slides[0].key, times: 0 })
  return {
    slides,
    active: slides.find((s) => s.key === shown.key) ?? slides[0],
    /** Shows a slide; a video starts from the beginning, also when it's already the one shown. */
    show: (key: string) => setShown((s) => ({ key, times: s.times + 1 })),
    /** How many times something was picked: 0 until the visitor does. */
    times: shown.times,
    markBroken: (key: VideoKey) => setBroken((b) => [...b, key]),
  }
}

export type ProductMediaState = ReturnType<typeof useProductMedia>

export function ProductMedia({ name, media }: { name: string; media: ProductMediaState }) {
  const { slides, active, show, times } = media
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [paused, setPaused] = useState(true)
  const [progress, setProgress] = useState({ current: 0, duration: 0 })
  const videoSlides = slides.filter((s) => s.kind === "video")
  const activeVideo = active.kind === "video" ? active.video : null

  // `muted` set as a property: React doesn't set it on server-rendered HTML, and
  // phones only start a video by themselves while it's muted. Runs before play() below.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, active.key])

  // Like Reels: the video plays as soon as it's shown, without sound until the
  // visitor turns it on. On the first view it waits for a tap if they asked for less motion.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !activeVideo) return
    // Failed before the page came alive, when the error event had no listener yet.
    if (el.error) return media.markBroken(active.key as VideoKey)
    setProgress({ current: 0, duration: activeVideo.durationMs / 1000 })
    el.currentTime = 0
    if (times === 0 && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    el.play().catch((e: Error) => {
      if (e.name === "NotSupportedError") media.markBroken(active.key as VideoKey)
      else setPaused(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.key, times])

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => setPaused(true))
    else el.pause()
  }

  /** After the review comes the sample, then the photos. */
  const next = () => {
    const after = slides[slides.indexOf(active) + 1]
    if (after) show(after.key)
  }

  return (
    <div>
      <div className="relative aspect-[4/5] bg-white dark:bg-zinc-900 rounded-xl overflow-hidden">
        {active.kind === "image" ? (
          <ProductImage
            src={active.src}
            alt={name}
            width={800}
            height={1000}
            sizes="(min-width: 1024px) 480px, (min-width: 768px) 50vw, 100vw"
            priority={active === slides[0]}
            className="w-full h-full object-cover"
          />
        ) : (
          <>
            <video
              key={active.key}
              ref={videoRef}
              src={active.video.src}
              poster={active.video.poster}
              muted={muted}
              playsInline
              preload="metadata"
              aria-label={`${BADGE[active.key]}: ${name}`}
              className="h-full w-full bg-zinc-900 object-cover"
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onTimeUpdate={(e) => {
                const el = e.currentTarget
                setProgress({ current: el.currentTime, duration: el.duration || active.video.durationMs / 1000 })
              }}
              onEnded={next}
              onError={() => media.markBroken(active.key)}
            />

            {/* The whole frame pauses and resumes, as on Instagram. */}
            <button
              type="button"
              onClick={togglePlay}
              aria-label={paused ? "Відтворити відео" : "Пауза"}
              className="absolute inset-0 flex items-center justify-center"
            >
              {paused && (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                  <Play className="h-7 w-7 translate-x-0.5 fill-current" aria-hidden />
                </span>
              )}
            </button>

            <div className="absolute inset-x-3 top-3 flex gap-1.5">
              {videoSlides.map((s) => {
                const i = videoSlides.indexOf(s)
                const current = videoSlides.indexOf(active)
                const filled =
                  i < current ? 1 : i > current ? 0 : progress.duration ? progress.current / progress.duration : 0
                return (
                  <button
                    type="button"
                    key={s.key}
                    onClick={() => show(s.key)}
                    aria-label={BADGE[s.key as VideoKey]}
                    className="flex-1 py-1.5"
                  >
                    <span className="block h-[3px] overflow-hidden rounded-full bg-white/40">
                      <span
                        className="block h-full rounded-full bg-white transition-[width] duration-200 ease-linear"
                        style={{ width: `${Math.min(1, filled) * 100}%` }}
                      />
                    </span>
                  </button>
                )
              })}
            </div>

            <span className="pointer-events-none absolute left-3 top-9 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
              {BADGE[active.key]}
            </span>

            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Увімкнути звук" : "Вимкнути звук"}
              aria-pressed={!muted}
              className="absolute right-3 top-9 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"
            >
              {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
            </button>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-3 pt-10 text-white">
              {active.video.caption && <p className="text-sm font-semibold text-balance">{active.video.caption}</p>}
              {progress.duration > 0 && (
                <p className="mt-0.5 text-xs tabular-nums text-white/80">
                  {clock(progress.current)} / {clock(progress.duration)}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {slides.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {slides.map((s) => {
            const current = s === active
            const border = current
              ? "border-zinc-900 dark:border-zinc-100"
              : "border-transparent hover:border-zinc-300"
            if (s.kind === "image") {
              return (
                <button
                  type="button"
                  key={s.key}
                  onClick={() => show(s.key)}
                  aria-label={`Фото ${slides.filter((x) => x.kind === "image").indexOf(s) + 1}`}
                  aria-current={current}
                  className={`h-16 w-14 shrink-0 overflow-hidden rounded-md border-2 ${border}`}
                >
                  <ProductImage src={s.src} alt="" width={56} height={64} sizes="56px" className="h-full w-full object-cover" />
                </button>
              )
            }
            return (
              <button
                type="button"
                key={s.key}
                onClick={() => show(s.key)}
                aria-current={current}
                className={`flex h-16 shrink-0 items-center gap-2 rounded-md border-2 bg-white pl-1 pr-3 text-left dark:bg-zinc-900 ${border}`}
              >
                <span className="relative h-[52px] w-11 shrink-0 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                  <VideoThumb video={s.video} fallback={slides.find((x) => x.kind === "image")?.src} />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <Play className="h-4 w-4 fill-white text-white" aria-hidden />
                  </span>
                </span>
                <span className="text-sm leading-tight">
                  <span className="block font-medium text-zinc-900 dark:text-zinc-50">{THUMB_LABEL[s.key]}</span>
                  <span className="block text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {s.video.durationMs > 0 ? clock(s.video.durationMs / 1000) : "відео"}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A frame of the video from Drive; the product photo while Drive has none (a fresh upload). */
function VideoThumb({ video, fallback }: { video: ProductVideo; fallback?: string }) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  // Failed before the page came alive, when onError had no listener yet.
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && !img.naturalWidth) setFailed(true)
  }, [])
  if (failed) {
    return fallback ? (
      <ProductImage src={fallback} alt="" width={44} height={52} sizes="44px" className="h-full w-full object-cover" />
    ) : null
  }
  return (
    <img
      ref={imgRef}
      src={video.thumb}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  )
}
