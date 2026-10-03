"use client"

import { useEffect, useRef, useState } from "react"

// A daily bar chart for the statistics pages: one bar per day, stacked when
// there is more than one series, with a tooltip on hover or tap. Counts only.

export interface Series {
  name: string
  /** CSS colour of the series' bars. */
  color: string
}

export interface BarDay {
  /** YYYY-MM-DD */
  day: string
  /** One value per series, in the order of `series`. */
  values: number[]
}

const H = 180
const PAD = { top: 8, right: 4, bottom: 22, left: 28 }
const plotH = H - PAD.top - PAD.bottom

/** The smallest 1/2/5×10ⁿ at or above n, so gridlines fall on round numbers. */
function niceMax(n: number): number {
  if (n <= 0) return 4
  const p = 10 ** Math.floor(Math.log10(n))
  const step = [1, 2, 5, 10].find((s) => s * p >= n)!
  return Math.max(step * p, 4)
}

const asDate = (day: string) => new Date(`${day}T12:00:00Z`)
const shortDate = (day: string) => `${asDate(day).getUTCDate()}.${asDate(day).getUTCMonth() + 1}`
const longDate = (day: string) =>
  asDate(day).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "UTC" })

/** A bar rectangle with its top corners rounded (radius r), sitting on y + h. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

export function BarChart({ title, series, data }: { title: string; series: Series[]; data: BarDay[] }) {
  const [active, setActive] = useState<number | null>(null)
  // Drawn at the width it is shown at, so the axis text stays at its real size on a phone too.
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(480)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setW(Math.max(Math.round(entry.contentRect.width), 200)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const plotW = W - PAD.left - PAD.right
  const totals = data.map((d) => d.values.reduce((s, v) => s + v, 0))
  const max = niceMax(Math.max(0, ...totals))
  const band = plotW / Math.max(data.length, 1)
  const barW = Math.max(Math.min(band * 0.7, 24), 2)
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH
  const ticks = [0, max / 2, max]
  const labelEvery = Math.ceil(data.length / Math.max(Math.floor(plotW / 48), 2))
  const hovered = active === null ? null : data[active]

  return (
    <figure className="rounded-2xl border border-zinc-200 bg-white p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900">{title}</span>
        {series.length > 1 && (
          <span className="flex flex-wrap gap-3 text-xs text-zinc-600">
            {series.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                {s.name}
              </span>
            ))}
          </span>
        )}
      </figcaption>

      <div ref={box} className="relative mt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`${title}: усього ${totals.reduce((s, v) => s + v, 0)} за ${data.length} дн. Подробиці — у таблиці нижче.`}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "#d4d4d8" : "#f0f0f1"}
                strokeWidth={1}
              />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#71717a" className="tabular-nums">
                {t}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const x = PAD.left + i * band + (band - barW) / 2
            let base = 0
            const top = d.values.reduce((last, v, k) => (v > 0 ? k : last), -1)
            return (
              <g key={d.day} opacity={active === null || active === i ? 1 : 0.45}>
                {d.values.map((v, k) => {
                  if (v <= 0) return null
                  const y0 = y(base + v)
                  // A 2px gap between stacked segments.
                  const h = y(base) - y0 - (base > 0 ? 2 : 0)
                  base += v
                  return h > 0 ? (
                    <path key={k} d={k === top ? topRounded(x, y0, barW, h, 4) : `M${x},${y0}h${barW}v${h}h${-barW}Z`} fill={series[k].color} />
                  ) : null
                })}
              </g>
            )
          })}

          {data.map((d, i) =>
            (data.length - 1 - i) % labelEvery === 0 ? (
              <text
                key={d.day}
                x={PAD.left + i * band + band / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize={11}
                fill="#71717a"
              >
                {shortDate(d.day)}
              </text>
            ) : null,
          )}

          {/* Hit targets: the full height of each day, wider than its bar. */}
          {data.map((d, i) => (
            <rect
              key={d.day}
              x={PAD.left + i * band}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(active === i ? null : i)}
            />
          ))}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg"
            // Beside the day's bar, never over it: to its right in the left half, to its left in the right half.
            style={
              PAD.left + (active! + 0.5) * band < W / 2
                ? { left: PAD.left + (active! + 1) * band + 6 }
                : { right: W - (PAD.left + active! * band) + 6 }
            }
          >
            <p className="font-medium text-zinc-900">{longDate(hovered.day)}</p>
            {series.map((s, k) => (
              <p key={s.name} className="mt-1 flex items-center justify-between gap-4 text-zinc-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {s.name}
                </span>
                <span className="font-medium tabular-nums text-zinc-900">{hovered.values[k]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
