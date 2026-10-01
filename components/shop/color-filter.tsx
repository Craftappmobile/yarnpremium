"use client"

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { Check } from "lucide-react"
import type { Product } from "./data"
import { COLOR_FAMILIES, type ColorFamily, type Shade, hueName, oklchToHex, shadeHex } from "./yarn-colors"

interface ColorFilterProps {
  products: Product[]
  families: ColorFamily[]
  shade: Shade | null
  onChange: (families: ColorFamily[], shade: Shade | null) => void
}

const MULTI_SWATCH = "conic-gradient(#d0312d, #eccb4a, #4f9150, #239f9a, #3a64b4, #7c55ad, #d0312d)"
const DEFAULT_SHADE: Shade = { h: 145, l: 0.6 }
const L_MIN = 0.3
const L_MAX = 0.88

/** The wheel's colours: every 15° of OKLCH hue. Always bright, so hues are easy to tell apart; the middle shows the actual shade. */
function wheelGradient(l = 0.68) {
  const stops = Array.from({ length: 25 }, (_, i) => oklchToHex({ l, c: 0.14, h: i * 15 }))
  return `conic-gradient(${stops.join(", ")})`
}

/**
 * Colour filter: tap one or more colour groups, or open «Точніше» and turn the
 * wheel to a hue (with a lighter/darker slider) for an exact shade.
 */
export function ColorFilter({ products, families, shade, onChange }: ColorFilterProps) {
  const [wheelOpen, setWheelOpen] = useState(shade !== null)
  const wheelRef = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => {
    const c: Partial<Record<ColorFamily, number>> = {}
    for (const p of products) if (p.colorFamily) c[p.colorFamily] = (c[p.colorFamily] ?? 0) + 1
    return c
  }, [products])
  const available = COLOR_FAMILIES.filter((f) => counts[f.id] || families.includes(f.id))

  const toggleFamily = (id: ColorFamily) =>
    onChange(families.includes(id) ? families.filter((f) => f !== id) : [...families, id], shade)

  const current = shade ?? DEFAULT_SHADE
  const setShade = (next: Shade) => onChange(families, next)

  // Angle of the touch point around the wheel's centre: 0° at the top, clockwise,
  // as conic-gradient draws it.
  const hueAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = wheelRef.current!.getBoundingClientRect()
    const dx = e.clientX - (box.left + box.width / 2)
    const dy = e.clientY - (box.top + box.height / 2)
    return Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360)
  }
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId)
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    setShade({ ...current, h: hueAt(e) })
  }
  const onWheelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10, PageUp: 45, PageDown: -45 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    setShade({ ...current, h: (current.h + step + 360) % 360 })
  }

  const marker = (current.h * Math.PI) / 180

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-4 gap-x-2 gap-y-3" aria-label="Групи кольорів">
        {available.map((f) => {
          const checked = families.includes(f.id)
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => toggleFamily(f.id)}
                aria-pressed={checked}
                aria-label={`${f.label}: ${counts[f.id] ?? 0}`}
                className="group flex w-full flex-col items-center gap-1.5 rounded-md py-1"
              >
                <span
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-transform ${
                    checked
                      ? "border-transparent ring-2 ring-zinc-900 ring-offset-2 ring-offset-zinc-50"
                      : "border-zinc-300 group-hover:scale-105"
                  }`}
                  style={{ background: f.id === "multi" ? MULTI_SWATCH : f.swatch }}
                >
                  {checked && (
                    <Check
                      aria-hidden
                      className={`h-4 w-4 ${["white", "beige", "yellow", "pink"].includes(f.id) ? "text-zinc-900" : "text-white"}`}
                    />
                  )}
                </span>
                <span className={`text-center text-xs leading-tight ${checked ? "font-medium text-zinc-900" : "text-zinc-600"}`}>
                  {f.label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="rounded-lg border border-zinc-200 bg-white">
        <button
          type="button"
          onClick={() => setWheelOpen((o) => !o)}
          aria-expanded={wheelOpen}
          aria-controls="shade-picker"
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-zinc-800"
        >
          <span className="flex items-center gap-2 text-left">
            <span
              aria-hidden
              className="h-4 w-4 shrink-0 rounded-full border border-zinc-300"
              style={{ background: shade ? shadeHex(shade) : wheelGradient() }}
            />
            {shade ? `Відтінок: ${hueName(shade).toLowerCase()}` : "Точніше: вибрати відтінок"}
          </span>
          <span aria-hidden className="text-zinc-500">
            {wheelOpen ? "−" : "+"}
          </span>
        </button>

        {wheelOpen && (
          <div id="shade-picker" className="space-y-4 border-t border-zinc-200 px-3 pb-4 pt-4">
            <p className="text-xs text-zinc-500">Торкніться кола або проведіть по ньому пальцем.</p>
            <div
              ref={wheelRef}
              role="slider"
              tabIndex={0}
              aria-label="Відтінок"
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={current.h}
              aria-valuetext={hueName(current)}
              onPointerDown={onPointer}
              onPointerMove={onPointer}
              onKeyDown={onWheelKey}
              className="relative mx-auto aspect-square w-full max-w-[208px] cursor-pointer touch-none select-none rounded-full"
              style={{ background: wheelGradient() }}
            >
              {/* Hole in the middle shows the picked shade. */}
              <div
                className="absolute inset-[22%] rounded-full border-4 border-white shadow-inner"
                style={{ background: shade ? shadeHex(shade) : "#fff" }}
              />
              {/* Marker on the ring at the picked hue. */}
              <span
                aria-hidden
                className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-md"
                style={{
                  left: `${50 + 39 * Math.sin(marker)}%`,
                  top: `${50 - 39 * Math.cos(marker)}%`,
                  background: shadeHex(current),
                }}
              />
            </div>

            <label className="block">
              <span className="mb-1.5 flex justify-between text-xs text-zinc-500">
                <span>Темніше</span>
                <span>Світліше</span>
              </span>
              <input
                type="range"
                min={L_MIN}
                max={L_MAX}
                step={0.01}
                value={current.l}
                aria-label="Світлість відтінку"
                onChange={(e) => setShade({ ...current, l: Number(e.target.value) })}
                className="shade-slider h-3 w-full cursor-pointer appearance-none rounded-full"
                style={{
                  background: `linear-gradient(to right, ${oklchToHex({ l: L_MIN, c: 0.14, h: current.h })}, ${oklchToHex({ l: L_MAX, c: 0.14, h: current.h })})`,
                }}
              />
            </label>

            {shade ? (
              <button
                type="button"
                onClick={() => onChange(families, null)}
                className="text-xs font-medium text-zinc-600 underline underline-offset-4 hover:text-zinc-900"
              >
                Скинути відтінок
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShade(current)}
                className="w-full rounded-md border border-zinc-300 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
              >
                Показати цей відтінок
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
