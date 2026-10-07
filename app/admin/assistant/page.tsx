import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { redisConfigured } from "@/lib/redis"
import { type SyncReport, readCatalogMeta } from "@/lib/catalog"
import {
  type AddOnSummary,
  type DayStats,
  type StatsSummary,
  type VideoSummary,
  readStats,
  statsKeyValid,
  summarize,
  summarizeAddOn,
  summarizeVideo,
} from "@/lib/assistant/stats"
import { ADD_ON, formatPrice } from "@/components/shop/data"
import { BarChart } from "@/components/admin/bar-chart"

// Whether the shopping assistant pays off, for the shop's owner:
// /admin/assistant?key=<ASSISTANT_STATS_KEY>&days=30. The same figures as
// /api/assistant/stats, in words, tiles, charts and a table.

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Статистика консультанта", robots: { index: false, follow: false } }

const PERIODS = [7, 30, 90]
/** Categorical slots 1 and 2 of the charts' palette (validated for colour blindness on white). */
const BLUE = "#2a78d6"
const ORANGE = "#eb6834"

const usd = (n: number, digits = 2) =>
  `$${n.toLocaleString("uk-UA", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const uah = (n: number | null) => (n === null ? "—" : formatPrice(Math.round(n)).replace(/,00(?= ₴)/, ""))
const percent = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`)
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function Verdict({ s, days }: { s: StatsSummary; days: number }) {
  if (s.conversations === 0) {
    return (
      <p>
        За {days} {plural(days, "день", "дні", "днів")} ще не було жодної розмови з консультантом. Цифри зʼявляться,
        щойно покупці почнуть писати в чат.
      </p>
    )
  }
  const sentences = [
    `За ${days} ${plural(days, "день", "дні", "днів")} консультант провів ${s.conversations} ${plural(s.conversations, "розмову", "розмови", "розмов")}` +
      (s.costUsd !== null ? ` і коштував ${usd(s.costUsd)}.` : "."),
    s.ordersAssisted > 0
      ? `Ті, хто писав у чат, оформили ${s.ordersAssisted} ${plural(s.ordersAssisted, "замовлення", "замовлення", "замовлень")} на ${uah(s.revenueAssisted)} — це ${percent(s.assistedShare)} усіх замовлень сайту.`
      : "Після розмов із консультантом замовлень поки не було.",
    s.revenueFromCards > 0 && `Товари, додані в кошик прямо з карток консультанта, принесли ${uah(s.revenueFromCards)}.`,
    s.averageOrderAssisted !== null &&
      s.averageOrderOther !== null &&
      s.averageOrderOther > 0 &&
      (() => {
        const diff = Math.round((s.averageOrderAssisted / s.averageOrderOther - 1) * 100)
        return diff === 0
          ? "Середній чек із чатом такий самий, як без нього."
          : `Середній чек із чатом на ${Math.abs(diff)}% ${diff > 0 ? "вищий" : "нижчий"}, ніж без нього.`
      })(),
  ].filter(Boolean)
  return <p>{sentences.join(" ")}</p>
}

/** Orders per 100 visitors, with one decimal: these rates are a few percent. */
const rate = (n: number | null) => (n === null ? "—" : `${(n * 100).toLocaleString("uk-UA", { maximumFractionDigits: 1 })}%`)

/** Where the videos stand after the last catalog sync: found in Drive, copies in Bunny. */
function VideoSync({ report }: { report: SyncReport["videos"] | undefined }) {
  let text: string
  let problem = false
  if (!report) {
    text = "Відео не налаштовані: у Vercel немає ключа Google Drive або папок."
    problem = true
  } else if ("error" in report) {
    text = `Google Drive не прочитався: ${report.error}. Відео на сайті лишились з попередньої синхронізації.`
    problem = true
  } else {
    const b = report.bunny
    const found = `На Drive знайдено оглядів: ${report.review}, зразків: ${report.sample}.`
    const unmatched = report.unmatched.length
      ? ` Без товару (перевірте артикул у назві): ${report.unmatched.slice(0, 10).join(", ")}${report.unmatched.length > 10 ? "…" : ""}.`
      : ""
    if (!b) {
      text = `${found} Bunny Stream не налаштований, тож на сайті відео не показуються.${unmatched}`
      problem = true
    } else if ("error" in b) {
      text = `${found} Bunny Stream не відповів: ${b.error}. Готові відео й далі показуються, нові чекають.${unmatched}`
      problem = true
    } else {
      text =
        `${found} У Bunny готово: ${b.ready}, конвертується: ${b.processing}` +
        (b.failed ? `, не вдалося: ${b.failed} (спробуємо ще раз через добу)` : "") +
        (b.noMp4 ? `. ${b.noMp4} без MP4: увімкніть «MP4 fallback» у бібліотеці Bunny` : "") +
        `.${unmatched}`
      problem = b.failed > 0 || b.noMp4 > 0 || unmatched !== ""
    }
  }
  return (
    <p className={`rounded-2xl border p-4 text-sm ${problem ? "border-amber-300 bg-amber-50 text-amber-900" : "border-zinc-200 bg-white text-zinc-700"}`}>
      {text}
    </p>
  )
}

function AddOnSection({ a, days }: { a: AddOnSummary; days: number }) {
  const period = `${days} ${plural(days, "день", "дні", "днів")}`
  const verdict =
    a.addOns === 0
      ? `За ${period} доповнень ще не було. Їх пропонують ${ADD_ON.minutes} хв після оформлення на сторінці «Дякуємо» (−${ADD_ON.percent}%, не більше ${ADD_ON.percent}% від суми замовлення).`
      : `За ${period} до ${a.addOns} ${plural(a.addOns, "замовлення", "замовлень", "замовлень")} з ${a.orders} додали ще товарів (${percent(a.takeRate)}) на ${uah(a.revenue)}; знижка на них — ${uah(a.discount)}.`
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Доповнення після замовлення</h2>
      <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-base leading-relaxed text-zinc-800">{verdict}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Замовлення з доповненням" value={`${a.addOns} з ${a.orders}`} note={`${percent(a.takeRate)} усіх замовлень`} />
        <Tile label="Виторг доповнень" value={uah(a.revenue)} note={`середнє доповнення: ${uah(a.averageAddOn)}`} />
        <Tile label="Віддали знижкою" value={uah(a.discount)} />
        <Tile label="Середній чек вищий на" value={uah(a.averageOrderLift)} note="виторг доповнень на кожне замовлення" />
      </div>
    </section>
  )
}

function VideoSection({ v, days, sync }: { v: VideoSummary; days: number; sync: SyncReport["videos"] | undefined }) {
  const share = (part: number, whole: number) => (whole > 0 ? percent(part / whole) : "—")
  let verdict: string
  if (v.pages === 0) {
    verdict = `За ${days} ${plural(days, "день", "дні", "днів")} ніхто ще не відкривав товар із відео. Цифри зʼявляться, щойно на картках будуть відео з Google Drive.`
  } else if (v.sampleCompleted < 30 || v.ordersPage < 10) {
    verdict = `Сторінки з відео відкрили ${v.pages} разів, зразок до кінця додивились ${v.sampleCompleted}. Для висновку замало: зачекайте, доки буде хоча б 30 переглядів зразка до кінця і 10 замовлень.`
  } else if (v.conversionSample !== null && v.conversionNoSample !== null && v.conversionNoSample > 0) {
    const times = v.conversionSample / v.conversionNoSample
    verdict =
      times >= 1.2
        ? `Ті, хто додивився зразок, купують у ${times.toLocaleString("uk-UA", { maximumFractionDigits: 1 })} раза частіше за решту. Відео варто знімати й для інших товарів.`
        : times <= 0.8
          ? "Ті, хто додивився зразок, купують не частіше за решту. Відео поки не видно в продажах."
          : "Ті, хто додивився зразок, купують приблизно так само часто, як решта."
  } else {
    verdict = "Замовлень після відео поки немає."
  }
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Відео на картках товарів</h2>
      <VideoSync report={sync} />
      <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-base leading-relaxed text-zinc-800">{verdict}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Відкрили товар із відео" value={String(v.pages)} note={`замовлень після цього: ${v.ordersPage}`} />
        <Tile
          label="Огляд до кінця"
          value={String(v.reviewCompleted)}
          note={`${share(v.reviewCompleted, v.reviewStarted)} з тих, хто почав (${v.reviewStarted})`}
        />
        <Tile
          label="Зразок до кінця"
          value={String(v.sampleCompleted)}
          note={`${share(v.sampleCompleted, v.sampleStarted)} з тих, хто почав (${v.sampleStarted})`}
        />
        <Tile label="Виторг після зразка" value={uah(v.revenueSampleCompleted)} note={`замовлень: ${v.ordersSampleCompleted}`} />
        <Tile label="Купують, хто додивився зразок" value={rate(v.conversionSample)} note={`решта: ${rate(v.conversionNoSample)}`} />
        <Tile label="Купують, хто додивився огляд" value={rate(v.conversionReview)} note={`решта: ${rate(v.conversionNoReview)}`} />
      </div>
      <p className="text-sm text-zinc-500">
        «Купують» — замовлень на 100 відвідувачів. Відвідувача рахуємо раз на день, замовлення — протягом тижня після
        перегляду, тож це оцінка. Як і з чатом, той, хто додивився до кінця, і так більше зацікавлений — різниця
        показує, чи варто знімати відео, але не доводить, що продало саме воно.
      </p>
    </section>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
    </div>
  )
}

function DayTable({ daily }: { daily: DayStats[] }) {
  const cols: [string, (d: DayStats) => string][] = [
    ["Розмови", (d) => String(d.conversations)],
    ["Повідомлення", (d) => String(d.messages)],
    ["Картки товарів", (d) => String(d.productsShown)],
    ["Замовлення", (d) => String(d.orders)],
    ["З чатом", (d) => String(d.ordersAssisted)],
    ["Виторг", (d) => uah(d.revenue)],
    ["Виторг із чатом", (d) => uah(d.revenueAssisted)],
    ["Витрати на ШІ", (d) => (d.costUsd === null ? "—" : usd(d.costUsd))],
  ]
  return (
    <details className="rounded-2xl border border-zinc-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-900">Таблиця за днями</summary>
      <div className="overflow-x-auto border-t border-zinc-200">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="px-4 py-2 font-medium">День</th>
              {cols.map(([name]) => (
                <th key={name} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day} className="border-t border-zinc-100 text-zinc-700">
                <td className="whitespace-nowrap px-4 py-2">{d.day.split("-").reverse().join(".")}</td>
                {cols.map(([name, cell]) => (
                  <td key={name} className="whitespace-nowrap px-3 py-2 text-right">
                    {cell(d)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export default async function AssistantStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const key = typeof params.key === "string" ? params.key : ""
  if (!statsKeyValid(key) || !redisConfigured()) notFound()

  const days = PERIODS.includes(Number(params.days)) ? Number(params.days) : 30
  const daily = await readStats(days)
  const s = summarize(daily)
  const video = summarizeVideo(daily)
  const addOn = summarizeAddOn(daily)
  const catalogMeta = await readCatalogMeta().catch(() => null)
  const chronological = [...daily].reverse()

  return (
    <main id="content" className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-zinc-900">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Чи продає консультант</h1>
          <p className="mt-1 text-sm text-zinc-500">Статистика ШІ-консультанта сайту, дні за київським часом</p>
        </div>
        <nav className="inline-flex rounded-xl border border-zinc-200 bg-white p-1 text-sm" aria-label="Період">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/admin/assistant?key=${encodeURIComponent(key)}&days=${p}`}
              aria-current={p === days ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 ${p === days ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {p} днів
            </Link>
          ))}
        </nav>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-base leading-relaxed text-zinc-800">
        <Verdict s={s} days={days} />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Розмови"
          value={String(s.conversations)}
          note={s.messagesPerConversation !== null ? `≈ ${s.messagesPerConversation.toLocaleString("uk-UA")} повід. на розмову` : undefined}
        />
        <Tile
          label="Замовлення з чатом"
          value={`${s.ordersAssisted} з ${s.orders}`}
          note={s.assistedShare !== null ? `${percent(s.assistedShare)} усіх замовлень` : "замовлень ще немає"}
        />
        <Tile label="Виторг із чатом" value={uah(s.revenueAssisted)} note={`з карток консультанта: ${uah(s.revenueFromCards)}`} />
        <Tile
          label="Витрати на ШІ"
          value={s.costUsd === null ? "—" : usd(s.costUsd)}
          note={s.costPerConversationUsd !== null ? `${usd(s.costPerConversationUsd, 3)} за розмову` : undefined}
        />
        <Tile
          label="Конверсія чату"
          value={s.ordersPerConversation === null ? "—" : percent(s.ordersPerConversation)}
          note="замовлень на кожні 100 розмов"
        />
        <Tile label="Середній чек із чатом" value={uah(s.averageOrderAssisted)} note={`без чату: ${uah(s.averageOrderOther)}`} />
        <Tile label="Показано карток товарів" value={String(s.productsShown)} />
        <Tile
          label="Збої"
          value={String(s.errors + s.refusals)}
          note={`помилки ${s.errors} · відмови ${s.refusals} · ліміт ${s.limited}`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Розмови за днями"
          series={[{ name: "Розмови", color: BLUE }]}
          data={chronological.map((d) => ({ day: d.day, values: [d.conversations] }))}
        />
        <BarChart
          title="Замовлення за днями"
          series={[
            { name: "Писали в чат", color: BLUE },
            { name: "Без чату", color: ORANGE },
          ]}
          data={chronological.map((d) => ({ day: d.day, values: [d.ordersAssisted, d.orders - d.ordersAssisted] }))}
        />
      </section>

      <DayTable daily={daily} />

      <AddOnSection a={addOn} days={days} />

      <VideoSection v={video} days={days} sync={catalogMeta?.videos} />

      <section className="space-y-2 rounded-2xl bg-zinc-100 p-5 text-sm leading-relaxed text-zinc-600">
        <p className="font-medium text-zinc-800">Як читати ці цифри</p>
        <p>
          «З чатом» — замовлення від покупців, які писали консультанту протягом тижня до замовлення. Хто пише в чат,
          той і так частіше купує, тому вища конверсія ще не доводить, що продав саме консультант. Чесну відповідь дасть
          лише порівняння: половині відвідувачів чат показувати, половині ні.
        </p>
        <p>
          Замовлення рахуються в момент оформлення, як у KeyCRM, а не після оплати. Витрати на ШІ — у доларах, за
          цінами Anthropic. Дані почали збиратися 3 жовтня 2026 року.
        </p>
      </section>
    </main>
  )
}
