"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

export interface AutocompleteOption {
  ref: string
  label: string
}

interface AutocompleteFieldProps {
  label: string
  placeholder: string
  /** Text currently shown in the input. */
  query: string
  onQueryChange: (value: string) => void
  options: AutocompleteOption[]
  onSelect: (option: AutocompleteOption) => void
  loading?: boolean
  disabled?: boolean
  error?: string
  /** Shown under the list when the query matched nothing. */
  emptyText?: string
  inputClass: string
}

/** Text input with a dropdown of server-provided suggestions. */
export function AutocompleteField({
  label,
  placeholder,
  query,
  onQueryChange,
  options,
  onSelect,
  loading,
  disabled,
  error,
  emptyText,
  inputClass,
}: AutocompleteFieldProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const listId = `${id}-list`
  const errorId = `${id}-error`

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // A new list of suggestions starts with nothing highlighted.
  useEffect(() => setActive(-1), [options])

  const expanded = open && options.length > 0
  const showEmpty = open && !loading && emptyText && query.trim().length >= 2 && options.length === 0

  const choose = (o: AutocompleteOption) => {
    onSelect(o)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-sm">
        {label} <span className="text-red-600">*</span>
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false)
            else if (e.key === "ArrowDown" && options.length) {
              e.preventDefault()
              setOpen(true)
              setActive((i) => (i + 1) % options.length)
            } else if (e.key === "ArrowUp" && options.length) {
              e.preventDefault()
              setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
            } else if (e.key === "Enter" && expanded && active >= 0) {
              e.preventDefault()
              choose(options[active])
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} ${error ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"} disabled:cursor-not-allowed disabled:opacity-60`}
        />
        {loading && (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin motion-reduce:animate-none text-zinc-500"
          />
        )}
      </div>
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options.map((o, i) => (
            <li
              key={o.ref}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so typing can continue after a click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="mt-1 text-xs text-zinc-500">
        {showEmpty ? emptyText : ""}
      </p>
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
