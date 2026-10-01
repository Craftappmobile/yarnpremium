"use client"

import { useRef } from "react"

/**
 * Radix returns focus to a Dialog.Trigger on close; our dialogs are opened by
 * other buttons (a product card, the cart icon), so remember whatever had focus
 * when the dialog opened and give it back on close.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement as HTMLElement | null
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault()
      opener.current?.focus()
    },
  }
}
