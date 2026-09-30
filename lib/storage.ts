// Safe localStorage helpers. Storage can be unavailable (private mode, blocked
// cookies, SSR) or hold malformed data, so every access is guarded.

export function readStorage(key: string): unknown {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled — the cart still works in memory.
  }
}

/** Parses the new value of a `storage` event (fired when another tab writes). */
export function parseStorageEvent(event: StorageEvent): unknown {
  try {
    return event.newValue ? JSON.parse(event.newValue) : null
  } catch {
    return null
  }
}
