import Link from "next/link"
import { BarChart } from "@/components/admin/bar-chart"
import { formatPriceShort } from "@/components/shop/data"
import { type TelegramDay, campaignTitle } from "@/lib/telegram-stats"

// What the Telegram channel and bot brought in a period, for /admin/telegram:
// visits from posts, «купити» clicks, orders and revenue after them, audience,
// and the same per post (lib/telegram-stats.ts).

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {note && <div className="mt-1 text-xs text-zinc-500">{note}</div>}
    </div>
  )
}

/** Categorical slots 1 and 2 of the charts' palette, as on the assistant's page. */
const BLUE = "#2a78d6"
const ORANGE = "#eb6834"

const uah = (n: number) => formatPriceShort(Math.round(n))
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** What the channel and the bot brought in the period: visits, orders, revenue, audience. */
export function TelegramResults({
  daily,
  days,
  periods,
  statsKey,
}: {
  daily: TelegramDay[]
  days: number
  periods: number[]
  statsKey: string
}) {
  const sum = (f: (d: TelegramDay) => number) => daily.reduce((s, d) => s + f(d), 0)
  const visits = sum((d) => d.visits)
  const buys = sum((d) => d.buys)
  const orders = sum((d) => d.orders)
  const revenue = sum((d) => d.revenue)
  const posts = sum((d) => d.posts)
  // Newest first: the latest known audience, and the oldest known one in the period.
  const known = daily.filter((d) => d.members !== null)
  const members = known[0]?.members ?? null
  const membersGrowth = known.length > 1 ? members! - known[known.length - 1].members! : null
  const subscribers = daily.find((d) => d.subscribers !== null)?.subscribers ?? null

  const campaigns = new Map<string, { visits: number; orders: number; revenue: number }>()
  for (const d of daily) {
    for (const [c, v] of Object.entries(d.campaigns)) {
      const t = campaigns.get(c) ?? { visits: 0, orders: 0, revenue: 0 }
      campaigns.set(c, { visits: t.visits + v.visits, orders: t.orders + v.orders, revenue: t.revenue + v.revenue })
    }
  }
  const byCampaign = [...campaigns.entries()].sort((a, b) => b[1].revenue - a[1].revenue || b[1].visits - a[1].visits)
  const chronological = [...daily].reverse()
  const period = `За ${days} ${plural(days, "день", "дні", "днів")}`

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Що дає Telegram</h2>
          <p className="text-sm text-zinc-500">Переходи з постів і бота на сайт, замовлення після них, дні за київським часом</p>
        </div>
        <nav className="inline-flex rounded-xl border border-zinc-200 bg-white p-1 text-sm" aria-label="Період">
          {periods.map((p) => (
            <Link
              key={p}
              href={`/admin/telegram?key=${encodeURIComponent(statsKey)}&days=${p}`}
              aria-current={p === days ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 ${p === days ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {p} днів
            </Link>
          ))}
        </nav>
      </div>

      <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-base leading-relaxed text-zinc-800">
        {visits === 0
          ? `${period} з Telegram на сайт ще ніхто не переходив. Цифри зʼявляться після перших постів.`
          : `${period} з Telegram на сайт було ${visits} ${plural(visits, "перехід", "переходи", "переходів")}, з них ${buys} — одразу в кошик через «купити». ` +
            (orders
              ? `Після цього оформили ${orders} ${plural(orders, "замовлення", "замовлення", "замовлень")} на ${uah(revenue)}.`
              : "Замовлень після переходів поки не було.") +
            (posts ? ` Опубліковано ${posts} ${plural(posts, "пост", "пости", "постів")}.` : "")}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile
          label="Переходи на сайт"
          value={String(visits)}
          note={`з каналу ${sum((d) => d.visitsChannel)} · з бота ${sum((d) => d.visitsBot)}`}
        />
        <Tile label="Натиснули «купити»" value={String(buys)} note="товар одразу в кошику" />
        <Tile
          label="Замовлення"
          value={String(orders)}
          note={visits ? `${((orders / visits) * 100).toLocaleString("uk-UA", { maximumFractionDigits: 1 })}% переходів` : undefined}
        />
        <Tile label="Виторг" value={uah(revenue)} note={orders ? `середній чек ${uah(revenue / orders)}` : undefined} />
        <Tile
          label="Підписники каналу"
          value={members === null ? "—" : String(members)}
          note={membersGrowth === null ? "рахуються щопівгодини" : `${membersGrowth >= 0 ? "+" : ""}${membersGrowth} за період`}
        />
        <Tile label="Підписники бота" value={subscribers === null ? "—" : String(subscribers)} note="отримують обрані категорії" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Переходи за днями"
          series={[
            { name: "З каналу", color: BLUE },
            { name: "З бота", color: ORANGE },
          ]}
          data={chronological.map((d) => ({ day: d.day, values: [d.visitsChannel, d.visitsBot] }))}
        />
        <BarChart
          title="Замовлення за днями"
          series={[{ name: "Замовлення", color: BLUE }]}
          data={chronological.map((d) => ({ day: d.day, values: [d.orders] }))}
        />
      </div>

      {byCampaign.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-5">
          <h3 className="font-semibold">За постами</h3>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-1.5 font-semibold">Пост</th>
                <th className="py-1.5 text-right font-semibold">Переходи</th>
                <th className="py-1.5 text-right font-semibold">Замовлення</th>
                <th className="py-1.5 text-right font-semibold">Виторг</th>
              </tr>
            </thead>
            <tbody>
              {byCampaign.map(([c, v]) => (
                <tr key={c} className="border-t border-zinc-100">
                  <td className="py-1.5">{campaignTitle(c)}</td>
                  <td className="py-1.5 text-right tabular-nums">{v.visits}</td>
                  <td className="py-1.5 text-right tabular-nums">{v.orders}</td>
                  <td className="py-1.5 text-right tabular-nums">{uah(v.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-zinc-500">
            Замовлення зараховується посту, з якого людина прийшла на сайт у тій самій вкладці. Те саме видно в Google
            Analytics (джерело telegram) і в KeyCRM (мітка utm_source=telegram).
          </p>
        </div>
      )}
    </section>
  )
}
