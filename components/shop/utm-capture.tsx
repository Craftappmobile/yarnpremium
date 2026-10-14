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
    if (utm.utm_source === "telegram") reportTelegramVisit(utm)
  }, [])
  return null
}

const TG_SEEN_KEY = "sinserita:tg-visits"

/**
 * Counts a visit from a Telegram post or the bot (lib/telegram-stats.ts), once
 * per link and session, so a reload or a second tab of it doesn't count again.
 */
function reportTelegramVisit(utm: Record<string, string>) {
  const href = window.location.pathname + window.location.search
  let seen: string[] = []
  try {
    seen = JSON.parse(sessionStorage.getItem(TG_SEEN_KEY) ?? "[]")
    if (seen.includes(href)) return
    sessionStorage.setItem(TG_SEEN_KEY, JSON.stringify([...seen, href].slice(-50)))
  } catch {
    // Storage unavailable: count it anyway.
  }
  const body = JSON.stringify({
    medium: utm.utm_medium,
    campaign: utm.utm_campaign,
    buy: window.location.pathname.startsWith("/buy"),
  })
  fetch("/api/telegram/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
    () => {},
  )
}

export function readUtm(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(UTM_KEY) ?? "{}") ?? {}
  } catch {
    return {}
  }
}
