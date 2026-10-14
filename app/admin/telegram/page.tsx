import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { readCatalog } from "@/lib/catalog"
import { redisConfigured } from "@/lib/redis"
import { statsKeyValid } from "@/lib/assistant/stats"
import { telegramConfigured } from "@/lib/telegram"
import { botStatus, subscriberCounts } from "@/lib/telegram-bot"
import { MAX_POSTS, POST_HOUR, introPost, plannedPosts, queueSize, readPostLog, renderPost } from "@/lib/telegram-news"
import { RUBRICS } from "@/lib/telegram-rubrics"

// The Telegram channel's daily post, for the shop's owner:
// /admin/telegram?key=<ASSISTANT_STATS_KEY>. Whether the bot can post, who
// subscribed to which rubric, what the next post will say, what went out.
// Orders from Telegram are in KeyCRM under utm_source=telegram.

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Telegram-канал", robots: { index: false, follow: false } }

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {note && <div className="mt-1 text-xs text-zinc-500">{note}</div>}
    </div>
  )
}

export default async function TelegramAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const key = typeof params.key === "string" ? params.key : ""
  if (!statsKeyValid(key) || !redisConfigured()) notFound()

  if (!telegramConfigured()) {
    return (
      <main id="content" className="mx-auto max-w-5xl px-4 py-8 text-zinc-900">
        <h1 className="text-2xl font-semibold">Telegram-канал</h1>
        <p className="mt-4">Бот не підключений: у налаштуваннях Vercel немає TELEGRAM_BOT_TOKEN.</p>
      </main>
    )
  }

  const [status, subs, queued, log, products] = await Promise.all([
    botStatus().catch((e: Error) => ({ error: e.message })),
    subscriberCounts(),
    queueSize(),
    readPostLog(),
    readCatalog(),
  ])
  const { posts } = await plannedPosts(products)
  const bot = "username" in status ? status.username : null

  return (
    <main id="content" className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-zinc-900">
      <header>
        <h1 className="text-2xl font-semibold">Telegram-канал</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Новинки виходять раз на день о {POST_HOUR}:12 за Києвом: до {MAX_POSTS} постів, дрібні оновлення разом в одному.
          Підписники бота отримують одне повідомлення з обраними категоріями. Замовлення з Telegram — у KeyCRM з міткою
          utm_source=telegram.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed">
        {"error" in status ? (
          <p className="text-red-700">Telegram не відповідає: {status.error}</p>
        ) : (
          <ul className="space-y-1">
            <li>
              Бот: <a className="underline" href={`https://t.me/${status.username}`}>@{status.username}</a>
            </li>
            <li>
              Канал {status.channel}:{" "}
              {status.canPost ? (
                <span className="text-green-700">бот — адміністратор, може публікувати</span>
              ) : (
                <span className="text-red-700">
                  бот не може публікувати ({status.channelStatus}). Додайте його адміністратором каналу з правом
                  «Публікація повідомлень».
                </span>
              )}
            </li>
            {status.channelMembers !== null && <li>Підписників каналу: {status.channelMembers}</li>}
            <li>
              Вебхук бота: {status.webhookUrl || "ще не встановлений (встановиться з найближчим запуском)"}
              {status.webhookError && <span className="text-red-700"> — остання помилка: {status.webhookError}</span>}
            </li>
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Підписники бота" value={String(subs.total)} note="отримують обрані рубрики в особисті" />
        <Tile label="Товарів у черзі" value={String(queued)} note="чекають на щоденний пост" />
        <Tile label="Постів наступного разу" value={String(posts.length)} note={`не більше ${MAX_POSTS} на день`} />
        <Tile label="Опубліковано" value={String(log.length)} note="останні 100 постів" />
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Підписники бота за категоріями</h2>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {RUBRICS.map((r) => (
              <tr key={r.key} className="border-t border-zinc-100">
                <td className="py-1.5">{r.title}</td>
                <td className="py-1.5 text-right tabular-nums">{subs.byRubric[r.key] ?? 0}</td>
                <td className="py-1.5 pl-4 text-xs text-zinc-500">
                  {bot && `t.me/${bot}?start=${r.key}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Наступний пост</h2>
        {posts.length === 0 && <p className="text-sm text-zinc-500">Поки нічого нового: черга порожня.</p>}
        {posts.map((post, i) => {
          const m = renderPost(post, bot)
          return (
            <article key={i} className="rounded-2xl border border-zinc-200 bg-white p-4">
              {m.photos.length > 0 && (
                <div className="mb-3 flex gap-2 overflow-x-auto">
                  {m.photos.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt="" className="h-24 w-24 flex-none rounded-lg object-cover" />
                  ))}
                </div>
              )}
              {/* The caption is Telegram's HTML subset (b, s, a), built and escaped in lib/telegram-news.ts. */}
              <div
                className="whitespace-pre-wrap text-sm leading-relaxed [&_a]:text-[#1A78B4] [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: m.caption }}
              />
            </article>
          )
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Закріплений пост «Як замовити»</h2>
        <p className="text-sm text-zinc-500">Виходить один раз, перед першими новинками, і закріплюється вгорі каналу.</p>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div
            className="whitespace-pre-wrap text-sm leading-relaxed [&_a]:text-[#1A78B4] [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: introPost(bot).caption }}
          />
        </article>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Опубліковані пости</h2>
        {log.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Ще нічого не публікувалося.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {log.map((e, i) => (
                <tr key={i} className="border-t border-zinc-100">
                  <td className="py-1.5 pr-4 text-zinc-500 tabular-nums">
                    {new Date(e.at).toLocaleString("uk-UA", { timeZone: "Europe/Kiev", dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="py-1.5">{e.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
