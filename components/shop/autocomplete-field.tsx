"use client"

import { useEffect, useRef, useState } from "react"
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
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const showEmpty = open && !loading && emptyText && query.trim().length >= 2 && options.length === 0

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1.5 block text-sm">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false)
          }}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          className={`${inputClass} ${error ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"} disabled:cursor-not-allowed disabled:opacity-60`}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />}
      </div>
      {open && options.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {options.map((o) => (
            <li key={o.ref}>
              <button
                type="button"
                onClick={() => {
                  onSelect(o)
                  setOpen(false)
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showEmpty && <p className="mt-1 text-xs text-zinc-400">{emptyText}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
