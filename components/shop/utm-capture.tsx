"use client"

import { useEffect } from "react"

const UTM_KEY = "sinserita:utm"
const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]

/** Remembers the utm_* parameters of the ad link a visitor arrived by, for the order sent to KeyCRM. */
export function UtmCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const utm = Object.fromEntries(UTM_PARAMS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])))
    if (Object.keys(utm).length === 0) return
    try {
      sessionStorage.setItem(UTM_KEY, JSON.stringify(utm))
    } catch {
      // Storage unavailable — the order just goes without UTM data.
    }
  }, [])
  return null
}

export function readUtm(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(UTM_KEY) ?? "{}") ?? {}
  } catch {
    return {}
  }
}
