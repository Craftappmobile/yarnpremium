"use client"

import type { AnchorHTMLAttributes, MouseEvent } from "react"

/**
 * A category (or the whole catalog) as a real link to its page, so it can be
 * opened in a new tab or copied, and search engines follow it. A plain click
 * keeps the catalog's own behaviour, `onSelect`: picking it in place, without
 * a page load.
 */
export function CatalogLink({
  onSelect,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; onSelect: () => void }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/⌘/Shift/Alt or another button: what the browser does with links.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onSelect()
  }
  return <a {...props} onClick={onClick} />
}
