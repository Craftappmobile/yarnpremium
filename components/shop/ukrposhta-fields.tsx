"use client"

import { useEffect, useState } from "react"
import { AutocompleteField } from "./autocomplete-field"
import { useLookup } from "./use-lookup"
import type { OrderDelivery } from "@/lib/order"

interface UkrposhtaFieldsProps {
  delivery: OrderDelivery
  onChange: (patch: Partial<OrderDelivery>) => void
  errors: Record<string, string>
  inputClass: string
}

type UpCity = NonNullable<OrderDelivery["city"]> & { ref: string }

export function UkrposhtaFields({ delivery, onChange, errors, inputClass }: UkrposhtaFieldsProps) {
  // null while unknown; false => bearer token missing, fall back to plain text fields.
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [cityQuery, setCityQuery] = useState(delivery.city?.name ?? "")
  const [pointQuery, setPointQuery] = useState(delivery.point?.name ?? "")

  const city = delivery.city

  useEffect(() => {
    let active = true
    fetch("/api/ukrposhta/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    })
      .then((r) => r.json())
      .then((d) => active && setConfigured(Boolean(d.configured)))
      .catch(() => active && setConfigured(false))
    return () => {
      active = false
    }
  }, [])

  const cities = useLookup<UpCity>(
    "/api/ukrposhta/cities",
    configured && cityQuery.trim().length >= 2 && cityQuery !== city?.name ? { query: cityQuery } : null,
    "cities",
  )

  const offices = useLookup<{ ref: string; postcode: string; description: string }>(
    "/api/ukrposhta/offices",
    configured && city?.ref
      ? {
          cityId: city.ref,
          // Once an office is picked its name fills the input; don't search by it.
          query: pointQuery === delivery.point?.name ? "" : pointQuery,
        }
      : null,
    "offices",
  )

  const plainInput = (err?: string) =>
    `${inputClass} ${err ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"}`

  // Plain-text fallback when the Ukrposhta token is not configured.
  if (configured === false) {
    return (
      <>
        <div>
          <label className="mb-1.5 block text-sm">
            Населений пункт <span className="text-red-500">*</span>
          </label>
          <input
            value={city?.name ?? ""}
            onChange={(e) => onChange({ city: { name: e.target.value } })}
            placeholder="Наприклад: Хмельницький"
            className={plainInput(errors.city)}
          />
          {errors.city && <p className="mt-1 text-xs text-red-500">{errors.city}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm">
            Відділення Укрпошти <span className="text-red-500">*</span>
          </label>
          <input
            value={delivery.point?.name ?? ""}
            onChange={(e) => onChange({ point: { name: e.target.value } })}
            placeholder="Індекс або номер відділення"
            className={plainInput(errors.point)}
          />
          {errors.point && <p className="mt-1 text-xs text-red-500">{errors.point}</p>}
        </div>
      </>
    )
  }

  return (
    <>
      <AutocompleteField
        label="Населений пункт"
        placeholder="Почніть вводити назву"
        query={cityQuery}
        onQueryChange={(v) => {
          setCityQuery(v)
          if (city) onChange({ city: undefined, point: undefined })
          setPointQuery("")
        }}
        options={cities.items.map((c) => ({ ref: c.ref, label: c.name }))}
        onSelect={(o) => {
          const picked = cities.items.find((c) => c.ref === o.ref)
          if (!picked) return
          setCityQuery(picked.name)
          onChange({ city: picked, point: undefined })
        }}
        loading={cities.loading}
        emptyText="Нічого не знайдено"
        error={errors.city}
        inputClass={inputClass}
      />

      <AutocompleteField
        label="Відділення Укрпошти"
        placeholder={city ? "Індекс або адреса" : "Спершу оберіть населений пункт"}
        query={pointQuery}
        onQueryChange={(v) => {
          setPointQuery(v)
          if (delivery.point) onChange({ point: undefined })
        }}
        options={offices.items.map((o) => ({ ref: o.ref, label: o.description }))}
        onSelect={(o) => {
          const picked = offices.items.find((w) => w.ref === o.ref)
          if (!picked) return
          setPointQuery(picked.description)
          onChange({ point: { name: picked.description, ref: picked.ref, postcode: picked.postcode } })
        }}
        loading={offices.loading}
        disabled={!city}
        emptyText="Відділень не знайдено"
        error={errors.point}
        inputClass={inputClass}
      />
    </>
  )
}
