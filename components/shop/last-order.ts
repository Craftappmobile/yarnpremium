import type { Order } from "@/lib/order"

// The last placed order is kept for the current browser tab only, so the
// confirmation page can show what was ordered (also after the trip to the
// payment page). Cleared when the tab closes.
const LAST_ORDER_KEY = "sinserita:last-order"

/** The order and the site's id for it (needed to pay it again). */
export interface LastOrder {
  id: string
  order: Order
  /** What was added to it on this page (ADD_ON), with its own site id. */
  addOn?: { id: string; order: Order }
  /** The buyer said no to the add-on offer. */
  addOnDeclined?: boolean
}

export function saveLastOrder(last: LastOrder): void {
  try {
    sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(last))
  } catch {
    // Storage unavailable — the confirmation page falls back to a generic message.
  }
}

export function loadLastOrder(): LastOrder | null {
  try {
    const raw = sessionStorage.getItem(LAST_ORDER_KEY)
    const saved = raw ? JSON.parse(raw) : null
    return saved?.order && typeof saved.id === "string" ? (saved as LastOrder) : null
  } catch {
    return null
  }
}
