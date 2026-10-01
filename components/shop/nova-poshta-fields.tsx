"use client"

import { useEffect, useState } from "react"
import { AutocompleteField } from "./autocomplete-field"
import { useLookup } from "./use-lookup"
import type { OrderDelivery } from "@/lib/order"

export type NpMode = "np_warehouse" | "np_postomat" | "np_courier"

interface NovaPoshtaFieldsProps {
  mode: NpMode
  delivery: OrderDelivery
  onChange: (patch: Partial<OrderDelivery>) => void
  errors: Record<string, string>
  inputClass: string
}

export function NovaPoshtaFields({ mode, delivery, onChange, errors, inputClass }: NovaPoshtaFieldsProps) {
  // null while unknown; false => API key missing, fall back to plain text fields.
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [cityQuery, setCityQuery] = useState(delivery.city?.name ?? "")
  const [pointQuery, setPointQuery] = useState(delivery.point?.name ?? "")
  const [streetQuery, setStreetQuery] = useState(delivery.address?.street ?? "")

  const city = delivery.city
  const address = delivery.address ?? { street: "", house: "" }

  useEffect(() => {
    let active = true
    fetch("/api/nova-poshta/cities", {
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

  // Switching between branch / postomat / courier invalidates the chosen point.
  useEffect(() => {
    setPointQuery("")
  }, [mode])

  const cities = useLookup<{ ref: string; settlementRef: string; name: string }>(
    "/api/nova-poshta/cities",
    configured && cityQuery.trim().length >= 2 && cityQuery !== city?.name ? { query: cityQuery } : null,
    "cities",
  )

  const points = useLookup<{ ref: string; description: string }>(
    "/api/nova-poshta/warehouses",
    configured && mode !== "np_courier" && city?.ref
      ? {
          cityRef: city.ref,
          kind: mode === "np_postomat" ? "postomat" : "branch",
          // Once a point is picked its name fills the input; don't search by it.
          query: pointQuery === delivery.point?.name ? "" : pointQuery,
        }
      : null,
    "warehouses",
  )

  const streets = useLookup<{ ref: string; name: string }>(
    "/api/nova-poshta/streets",
    configured && mode === "np_courier" && city?.settlementRef && streetQuery.trim().length >= 2 && streetQuery !== address.street
      ? { settlementRef: city.settlementRef, query: streetQuery }
      : null,
    "streets",
  )

  const pointLabel = mode === "np_postomat" ? "Поштомат" : "Відділення"
  const plainInput = (err?: string) =>
    `${inputClass} ${err ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"}`

  const houseFields = (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label htmlFor="np-house" className="mb-1.5 block text-sm">
          Будинок <span className="text-red-500">*</span>
        </label>
        <input
          id="np-house"
          aria-invalid={Boolean(errors.house)}
          value={address.house}
          onChange={(e) => onChange({ address: { ...address, house: e.target.value } })}
          className={plainInput(errors.house)}
        />
        {errors.house && <p className="mt-1 text-xs text-red-500">{errors.house}</p>}
      </div>
      <div>
        <label htmlFor="np-flat" className="mb-1.5 block text-sm">Квартира</label>
        <input
          id="np-flat"
          value={address.flat ?? ""}
          onChange={(e) => onChange({ address: { ...address, flat: e.target.value } })}
          className={plainInput()}
        />
      </div>
    </div>
  )

  // Plain-text fallback when the Nova Poshta API key is not configured.
  if (configured === false) {
    return (
      <>
        <div>
          <label htmlFor="np-city" className="mb-1.5 block text-sm">
            Населений пункт <span className="text-red-500">*</span>
          </label>
          <input
            id="np-city"
            aria-invalid={Boolean(errors.city)}
            value={city?.name ?? ""}
            onChange={(e) => onChange({ city: { name: e.target.value } })}
            placeholder="Наприклад: Київ"
            className={plainInput(errors.city)}
          />
          {errors.city && <p className="mt-1 text-xs text-red-500">{errors.city}</p>}
        </div>
        {mode === "np_courier" ? (
          <>
            <div>
              <label htmlFor="np-street" className="mb-1.5 block text-sm">
                Вулиця <span className="text-red-500">*</span>
              </label>
              <input
                id="np-street"
                aria-invalid={Boolean(errors.street)}
                value={address.street}
                onChange={(e) => onChange({ address: { ...address, street: e.target.value } })}
                className={plainInput(errors.street)}
              />
              {errors.street && <p className="mt-1 text-xs text-red-500">{errors.street}</p>}
            </div>
            {houseFields}
          </>
        ) : (
          <div>
            <label htmlFor="np-point" className="mb-1.5 block text-sm">
              {pointLabel} <span className="text-red-500">*</span>
            </label>
            <input
              id="np-point"
              aria-invalid={Boolean(errors.point)}
              value={delivery.point?.name ?? ""}
              onChange={(e) => onChange({ point: { name: e.target.value } })}
              placeholder={mode === "np_postomat" ? "Номер поштомата" : "Наприклад: Відділення №1"}
              className={plainInput(errors.point)}
            />
            {errors.point && <p className="mt-1 text-xs text-red-500">{errors.point}</p>}
          </div>
        )}
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
          if (city) onChange({ city: undefined, point: undefined, address: undefined })
          setPointQuery("")
          setStreetQuery("")
        }}
        options={cities.items.map((c) => ({ ref: c.ref, label: c.name }))}
        onSelect={(o) => {
          const picked = cities.items.find((c) => c.ref === o.ref)
          if (!picked) return
          setCityQuery(picked.name)
          onChange({ city: picked, point: undefined, address: undefined })
        }}
        loading={cities.loading}
        emptyText="Нічого не знайдено"
        error={errors.city}
        inputClass={inputClass}
      />

      {mode === "np_courier" ? (
        <>
          <AutocompleteField
            label="Вулиця"
            placeholder={city ? "Почніть вводити назву вулиці" : "Спершу оберіть населений пункт"}
            query={streetQuery}
            onQueryChange={(v) => {
              setStreetQuery(v)
              if (address.street) onChange({ address: { ...address, street: "", streetRef: undefined } })
            }}
            options={streets.items.map((s) => ({ ref: s.ref, label: s.name }))}
            onSelect={(o) => {
              setStreetQuery(o.label)
              onChange({ address: { ...address, street: o.label, streetRef: o.ref } })
            }}
            loading={streets.loading}
            disabled={!city}
            emptyText="Вулицю не знайдено"
            error={errors.street}
            inputClass={inputClass}
          />
          {houseFields}
        </>
      ) : (
        <AutocompleteField
          label={pointLabel}
          placeholder={city ? "Номер або адреса" : "Спершу оберіть населений пункт"}
          query={pointQuery}
          onQueryChange={(v) => {
            setPointQuery(v)
            if (delivery.point) onChange({ point: undefined })
          }}
          options={points.items.map((w) => ({ ref: w.ref, label: w.description }))}
          onSelect={(o) => {
            setPointQuery(o.label)
            onChange({ point: { name: o.label, ref: o.ref } })
          }}
          loading={points.loading}
          disabled={!city}
          emptyText={mode === "np_postomat" ? "Поштоматів не знайдено" : "Відділень не знайдено"}
          error={errors.point}
          inputClass={inputClass}
        />
      )}
    </>
  )
}
