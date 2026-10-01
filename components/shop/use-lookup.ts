"use client"

import { useEffect, useState } from "react"

/** Shown in place of «not found» when the carrier's list didn't load. */
export const LOOKUP_FAILED = "Не вдалося завантажити список. Перевірте інтернет і спробуйте ще раз."

/**
 * Debounced POST lookup against one of our /api/nova-poshta or /api/ukrposhta routes.
 * `body` = null disables the request and clears the results.
 */
export function useLookup<T>(url: string, body: Record<string, string> | null, field: string) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const key = body ? JSON.stringify(body) : null

  useEffect(() => {
    if (!key) {
      setItems([])
      setLoading(false)
      setFailed(false)
      return
    }
    let active = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: key })
        const data = await res.json()
        if (!res.ok) throw new Error(String(res.status))
        if (active) {
          setItems(data[field] ?? [])
          setFailed(false)
        }
      } catch {
        if (active) {
          setItems([])
          setFailed(true)
        }
      } finally {
        if (active) setLoading(false)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [url, key, field])

  return { items, loading, failed }
}
