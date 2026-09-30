import type { Order } from "@/lib/order"

// The last placed order is kept for the current browser tab only, so the
// confirmation page can show what was ordered. Cleared when the tab closes.
const LAST_ORDER_KEY = "sinserita:last-order"

export function saveLastOrder(order: Order): void {
  try {
    sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order))
  } catch {
    // Storage unavailable — the confirmation page falls back to a generic message.
  }
}

export function loadLastOrder(): Order | null {
  try {
    const raw = sessionStorage.getItem(LAST_ORDER_KEY)
    return raw ? (JSON.parse(raw) as Order) : null
  } catch {
    return null
  }
}
