"use client"

import { useEffect, useState } from "react"

/**
 * Debounced POST lookup against one of our /api/nova-poshta or /api/ukrposhta routes.
 * `body` = null disables the request and clears the results.
 */
export function useLookup<T>(url: string, body: Record<string, string> | null, field: string) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const key = body ? JSON.stringify(body) : null

  useEffect(() => {
    if (!key) {
      setItems([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: key })
        const data = await res.json()
        if (active) setItems(data[field] ?? [])
      } catch {
        if (active) setItems([])
      } finally {
        if (active) setLoading(false)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [url, key, field])

  return { items, loading }
}
