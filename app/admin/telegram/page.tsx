import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { readCatalog } from "@/lib/catalog"
import { redisConfigured } from "@/lib/redis"
import { statsKeyValid } from "@/lib/assistant/stats"
import { telegramConfigured } from "@/lib/telegram"
import { botStatus, subscriberCounts } from "@/lib/telegram-bot"
import { MAX_POSTS, POST_HOUR, introPost, plannedPosts, queueSize, readIntro, readPostLog, renderPost } from "@/lib/telegram-news"
import { RUBRICS } from "@/lib/telegram-rubrics"
import { readTelegramStats } from "@/lib/telegram-stats"
import { readStaffChat, staffCode } from "@/lib/telegram-staff"
import { reviewCount } from "@/lib/reviews"
import { readReviewsTopic } from "@/lib/reviews-intake"
import { TelegramResults } from "@/components/admin/telegram-results"

// The Telegram channel's daily post, for the shop's owner:
// /admin/telegram?key=<ASSISTANT_STATS_KEY>&days=30. What the channel and the
// bot bring (visits, orders, revenue, audience; lib/telegram-stats.ts),
// whether the bot can post, who subscribed to which rubric, what the next
// post will say, what went out.

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

const PERIODS = [7, 30, 90]

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

  const days = PERIODS.includes(Number(params.days)) ? Number(params.days) : 30
  const [status, subs, queued, log, products, daily, intro] = await Promise.all([
    botStatus().catch((e: Error) => ({ error: e.message })),
    subscriberCounts(),
    queueSize(),
    readPostLog(),
    readCatalog(),
    readTelegramStats(days),
    readIntro(),
  ])
  const [staff, reviewsTopic, reviews] = await Promise.all([
    readStaffChat().catch(() => null),
    readReviewsTopic().catch(() => null),
    reviewCount().catch(() => 0),
  ])
  const introResult = typeof params.intro === "string" ? params.intro : ""
  const introReason = typeof params.reason === "string" ? params.reason : ""
  const { posts } = await plannedPosts(products)
  const bot = "username" in status ? status.username : null

  return (
    <main id="content" className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-zinc-900">
      <header>
        <h1 className="text-2xl font-semibold">Telegram-канал</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Новинки виходять раз на день о {POST_HOUR}:12 за Києвом: до {MAX_POSTS} постів, дрібні оновлення разом в одному.
          Підписники бота отримують одне повідомлення з обраними категоріями.
        </p>
      </header>

      <TelegramResults daily={daily} days={days} periods={PERIODS} statsKey={key} />

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

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Кинуті кошики в робочу групу</h2>
        {staff ? (
          <p className="text-green-700">
            Бот повідомляє про кожен кинутий кошик у «{staff.title}» (з{" "}
            {new Date(staff.at).toLocaleDateString("uk-UA", { timeZone: "Europe/Kiev", dateStyle: "long" })}).
          </p>
        ) : (
          <p className="text-zinc-600">Ще не налаштовано: бот поки нікуди не повідомляє про кинуті кошики.</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700">
          <li>
            Лише <b>закрита</b> група вашої команди: у повідомленнях імʼя і телефон покупця. Не канал і не відкрита група.
          </li>
          <li>Додайте @{bot ?? "бота"} у групу (адміністратором, якщо в групі ввімкнено теми).</li>
          <li>
            У потрібній гілці (темі) надішліть:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-900">/abandoned_here {staffCode()}</code>
          </li>
          <li>Бот відповість «✅ Тут зʼявлятимуться кинуті кошики». Вимкнути: /abandoned_off {staffCode()}</li>
        </ol>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Відгуки з робочої групи на сайт</h2>
        {reviewsTopic ? (
          <p className="text-green-700">
            Відгуки з «{reviewsTopic.title}» самі з&apos;являються на картках товарів і на{" "}
            <a className="underline" href="/vidguky">
              сторінці відгуків
            </a>
            . Опубліковано: {reviews}.
          </p>
        ) : (
          <p className="text-zinc-600">Ще не налаштовано. Опубліковано відгуків: {reviews}.</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700">
          <li>
            У гілці «Відгуки» тієї ж групи надішліть:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-900">/reviews_here {staffCode()}</code>
          </li>
          <li>
            Менеджер публікує скриншот відповіді покупця (і фото виробу, якщо є) та посилання на товар або артикул. За
            кілька хвилин бот відповідає, що опублікував.
          </li>
          <li>
            Не той товар — відповісти боту посиланням чи артикулом. Прибрати — відповісти боту /review_delete. Вимкнути
            все: /reviews_off {staffCode()}
          </li>
        </ol>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Підписники бота" value={String(subs.total)} note="отримують обрані категорії в особисті" />
        <Tile label="Товарів у черзі" value={String(queued)} note="розпродані серед них чекають до 14 днів, чи повернуться" />
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
        <p className="text-sm text-zinc-500">
          {intro
            ? `Опубліковано ${new Date(intro.at).toLocaleString("uk-UA", { timeZone: "Europe/Kiev", dateStyle: "long", timeStyle: "short" })}${intro.pinned === false ? ", але не закріплено" : ""}. Нова публікація замінить його вгорі каналу.`
            : "Ще не публікувався. Вийде сам перед першими новинками, або опублікуйте його зараз."}
        </p>
        {introResult === "pinned" && (
          <p className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">Пост опубліковано і закріплено вгорі каналу.</p>
        )}
        {introResult === "notpinned" && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Пост опубліковано, але не закріплено. Дайте боту в каналі право «Редагування повідомлень» і опублікуйте ще раз
            {introReason ? ` (Telegram: ${introReason})` : ""}.
          </p>
        )}
        {introResult === "error" && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Не вдалося опублікувати: {introReason}</p>
        )}
        <form method="post" action="/api/telegram/intro">
          <input type="hidden" name="key" value={key} />
          <button
            type="submit"
            className="rounded-lg bg-[#1A78B4] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#15659A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A78B4]"
          >
            {intro ? "Опублікувати знову і закріпити" : "Опублікувати зараз і закріпити"}
          </button>
        </form>
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
