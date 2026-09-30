"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

interface City {
  ref: string
  name: string
}
interface Warehouse {
  ref: string
  description: string
}

interface NovaPoshtaSelectProps {
  city: string
  branch: string
  onCityChange: (value: string) => void
  onBranchChange: (value: string) => void
  cityError?: string
  branchError?: string
  inputClass: string
  cityErrCls: string
  branchErrCls: string
}

export function NovaPoshtaSelect({
  city,
  branch,
  onCityChange,
  onBranchChange,
  cityError,
  branchError,
  inputClass,
  cityErrCls,
  branchErrCls,
}: NovaPoshtaSelectProps) {
  const [cityQuery, setCityQuery] = useState(city)
  const [cities, setCities] = useState<City[]>([])
  const [cityRef, setCityRef] = useState<string | null>(null)
  const [showCityList, setShowCityList] = useState(false)
  const [loadingCities, setLoadingCities] = useState(false)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [showWhList, setShowWhList] = useState(false)
  const [loadingWh, setLoadingWh] = useState(false)

  // false => key missing, fall back to plain text fields.
  const [configured, setConfigured] = useState<boolean | null>(null)

  const cityBoxRef = useRef<HTMLDivElement>(null)
  const whBoxRef = useRef<HTMLDivElement>(null)

  // Detect on mount whether the API key is configured, so we can render the
  // plain-text fallback immediately instead of only after the first search.
  useEffect(() => {
    let active = true
    fetch("/api/nova-poshta/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (active) setConfigured(Boolean(d.configured))
      })
      .catch(() => {
        if (active) setConfigured(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Debounced city search.
  useEffect(() => {
    if (cityRef && cityQuery === city) return
    const q = cityQuery.trim()
    if (q.length < 2) {
      setCities([])
      return
    }
    setLoadingCities(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/nova-poshta/cities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        })
        const data = await res.json()
        setConfigured(data.configured)
        setCities(data.cities ?? [])
      } catch {
        setCities([])
      } finally {
        setLoadingCities(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [cityQuery, cityRef, city])

  // Load warehouses when a city is selected.
  const loadWarehouses = async (ref: string, q = "") => {
    setLoadingWh(true)
    try {
      const res = await fetch("/api/nova-poshta/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityRef: ref, query: q }),
      })
      const data = await res.json()
      setWarehouses(data.warehouses ?? [])
    } catch {
      setWarehouses([])
    } finally {
      setLoadingWh(false)
    }
  }

  // Close dropdowns on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityBoxRef.current && !cityBoxRef.current.contains(e.target as Node)) setShowCityList(false)
      if (whBoxRef.current && !whBoxRef.current.contains(e.target as Node)) setShowWhList(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const selectCity = (c: City) => {
    setCityRef(c.ref)
    setCityQuery(c.name)
    onCityChange(c.name)
    setShowCityList(false)
    onBranchChange("")
    setWarehouses([])
    loadWarehouses(c.ref)
  }

  // Plain-text fallback when the API key is not configured.
  if (configured === false) {
    return (
      <>
        <div>
          <label className="mb-1.5 block text-sm">
            Населений пункт <span className="text-red-500">*</span>
          </label>
          <input
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="Наприклад: Київ"
            className={`${inputClass} ${cityErrCls}`}
          />
          {cityError && <p className="mt-1 text-xs text-red-500">{cityError}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm">
            Відділення <span className="text-red-500">*</span>
          </label>
          <input
            value={branch}
            onChange={(e) => onBranchChange(e.target.value)}
            placeholder="Наприклад: Відділення №1"
            className={`${inputClass} ${branchErrCls}`}
          />
          {branchError && <p className="mt-1 text-xs text-red-500">{branchError}</p>}
        </div>
      </>
    )
  }

  return (
    <>
      <div ref={cityBoxRef} className="relative">
        <label className="mb-1.5 block text-sm">
          Населений пункт <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            value={cityQuery}
            onChange={(e) => {
              setCityQuery(e.target.value)
              setCityRef(null)
              onCityChange("")
              setShowCityList(true)
            }}
            onFocus={() => setShowCityList(true)}
            placeholder="Почніть вводити місто"
            className={`${inputClass} ${cityErrCls}`}
            autoComplete="off"
          />
          {loadingCities && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-zinc-400" />
          )}
        </div>
        {showCityList && cities.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
            {cities.map((c) => (
              <li key={c.ref}>
                <button
                  type="button"
                  onClick={() => selectCity(c)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {cityError && <p className="mt-1 text-xs text-red-500">{cityError}</p>}
      </div>

      <div ref={whBoxRef} className="relative">
        <label className="mb-1.5 block text-sm">
          Відділення <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            value={branch}
            onChange={(e) => {
              onBranchChange(e.target.value)
              if (cityRef) loadWarehouses(cityRef, e.target.value)
              setShowWhList(true)
            }}
            onFocus={() => {
              if (cityRef) setShowWhList(true)
            }}
            disabled={!cityRef}
            placeholder={cityRef ? "Оберіть відділення" : "Спершу оберіть місто"}
            className={`${inputClass} ${branchErrCls} disabled:cursor-not-allowed disabled:opacity-60`}
            autoComplete="off"
          />
          {loadingWh && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-zinc-400" />
          )}
        </div>
        {showWhList && warehouses.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
            {warehouses.map((w) => (
              <li key={w.ref}>
                <button
                  type="button"
                  onClick={() => {
                    onBranchChange(w.description)
                    setShowWhList(false)
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {w.description}
                </button>
              </li>
            ))}
          </ul>
        )}
        {branchError && <p className="mt-1 text-xs text-red-500">{branchError}</p>}
      </div>
    </>
  )
}
