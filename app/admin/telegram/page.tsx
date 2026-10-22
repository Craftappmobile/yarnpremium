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
import { readPhotoChannel, readPhotoLog, readWaitingColors } from "@/lib/telegram-photos"
import { readWeighings, readWeightsTopic } from "@/lib/telegram-weights"
import { readInviteLinks } from "@/lib/telegram-invites"
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
  const [staff, remnantsTopic, reviewsTopic, reviews, photoChannel, photoPending, photoLog] = await Promise.all([
    readStaffChat().catch(() => null),
    readStaffChat("remnants").catch(() => null),
    readReviewsTopic().catch(() => null),
    reviewCount().catch(() => 0),
    readPhotoChannel().catch(() => null),
    readWaitingColors().catch(() => []),
    readPhotoLog().catch(() => []),
  ])
  const [weightsTopic, weighings, invites] = await Promise.all([
    readWeightsTopic().catch(() => null),
    readWeighings().catch(() => []),
    readInviteLinks().catch(() => []),
  ])
  // The site's «Підписатися» buttons over the period.
  const byPlace = (place: string) =>
    daily.reduce(
      (sum, d) => {
        const p = d.places[place]
        return p ? { clicks: sum.clicks + p.clicks, joins: sum.joins + p.joins, leaves: sum.leaves + p.leaves } : sum
      },
      { clicks: 0, joins: 0, leaves: 0 },
    )
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

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Хто приходить у канал із сайту, за {days} днів</h2>
        <p className="text-zinc-600">
          Кожна кнопка «Підписатися» на сайті веде в канал своїм запрошувальним посиланням: Telegram каже боту, хто
          приєднався за ним. «Відписалися» — ті з них, хто потім вийшов з каналу.
        </p>
        {"canInvite" in status && !status.canInvite && invites.some((i) => !i.link) && (
          <p className="text-red-700">
            Бот не може створювати посилання: дайте йому в каналі право «Додавання підписників». Поки що кнопки ведуть
            на звичайну адресу каналу, і приєднання не рахуються.
          </p>
        )}
        <table className="w-full">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1.5 pr-4 font-normal">Кнопка</th>
              <th className="py-1.5 pr-4 font-normal">Натиснули</th>
              <th className="py-1.5 pr-4 font-normal">Приєдналися</th>
              <th className="py-1.5 font-normal">Відписалися</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => {
              const n = byPlace(i.place)
              return (
                <tr key={i.place} className="border-t border-zinc-100">
                  <td className="py-1.5 pr-4">
                    {i.name}
                    {!i.link && <span className="text-zinc-500"> · посилання створиться з першим натисканням</span>}
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums">{n.clicks}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{n.joins}</td>
                  <td className="py-1.5 tabular-nums">{n.leaves}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

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
        <h2 className="text-lg font-semibold">Залишки менше мінімуму в робочу групу</h2>
        {remnantsTopic ? (
          <p className="text-green-700">
            Бот повідомляє в «{remnantsTopic.title}» про продажі в KeyCRM, після яких лишився замалий залишок або
            продано менше мінімуму (з{" "}
            {new Date(remnantsTopic.at).toLocaleDateString("uk-UA", { timeZone: "Europe/Kiev", dateStyle: "long" })}).
          </p>
        ) : (
          <p className="text-zinc-600">Ще не налаштовано: бот поки нікуди не повідомляє про залишки.</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700">
          <li>
            Правило для пряжі на вагу: менше 100 г (кашемір — 50 г) продаємо лише весь залишок; після продажу на складі
            лишається 0 або не менше 100 г (кашемір — 50 г). Замовлення з усіх джерел перевіряються кожні 15 хвилин.
          </li>
          <li>
            У тій самій групі створіть окрему гілку і надішліть у ній:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-900">/remnants_here {staffCode()}</code>
          </li>
          <li>
            Бот відповість «✅ Тут з&apos;являтимуться продажі…». Повідомлення приходять про замовлення, зроблені після
            цього. Вимкнути: /remnants_off {staffCode()}
          </li>
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

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Фото товарів з каналу</h2>
        {photoChannel ? (
          <p className="text-green-700">
            Альбоми з «{photoChannel.title}» потрапляють на сайт і в KeyCRM. Чекають на артикул у KeyCRM:{" "}
            {photoPending.length ? photoPending.map((p) => p.caption).join(", ") : "немає"}.
          </p>
        ) : (
          <p className="text-zinc-600">Ще не налаштовано: бот не бере фото з жодного каналу.</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700">
          <li>Приватний канал, @{bot ?? "бот"} у ньому адміністратор з правом «Публікація повідомлень».</li>
          <li>
            Опублікуйте в каналі:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-900">/photos_here {staffCode()}</code>{" "}
            (бот видалить це повідомлення і відповість ✅). Вимкнути: /photos_off {staffCode()}
          </li>
          <li>
            Альбом до 6 фото, у підписі — артикул: «MO374» — на всі бобіни кольору (MO374-1, MO374-2…), і на ті, що
            з'являться в KeyCRM пізніше (90 днів); «MO362-1, MO362-2» — лише на ці бобіни; «+MO374» додає нові фото
            першими до наявних. Бобіни ще немає в KeyCRM — бот відповідає ⏳ і сам додає фото після синхронізації
            каталогу (кожні 30 хвилин).
          </li>
        </ol>
        {photoLog.length > 0 && (
          <table className="mt-3 w-full">
            <tbody>
              {photoLog.slice(0, 20).map((e, i) => (
                <tr key={i} className="border-t border-zinc-100 align-top">
                  <td className="whitespace-nowrap py-1.5 pr-4 tabular-nums text-zinc-500">
                    {new Date(e.at).toLocaleString("uk-UA", { timeZone: "Europe/Kiev", dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="py-1.5 pr-4 font-medium">
                    {e.ok ? "✅" : e.waiting ? "⏳" : "❌"} {e.sku || "—"}
                  </td>
                  <td className="py-1.5">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-5 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Вага бобін у KeyCRM</h2>
        {weightsTopic ? (
          <p className="text-green-700">Вага з «{weightsTopic.title}» стає залишком бобіни в KeyCRM і на сайті.</p>
        ) : (
          <p className="text-zinc-600">Ще не налаштовано.</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700">
          <li>
            У гілці «Вага» робочої групи надішліть:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-900">/weights_here {staffCode()}</code>.
            Вимкнути: /weights_off {staffCode()}
          </li>
          <li>Артикул бобіни і чиста вага в грамах, кожна бобіна з нового рядка: «MO362-1 326».</li>
          <li>Повідомлення зі словами або «?» («Зробіть контрольну вагу MER914-2», «MER914-2 315?») — розмова: бот нічого не записує.</li>
          <li>Вага від адміна «Sincerita» (у званні адміна, або анонімно від імені групи) — контрольна: бот позначає її 🔒.</li>
        </ol>
        {weighings.length > 0 && (
          <table className="mt-3 w-full">
            <tbody>
              {weighings.slice(0, 30).map((w, i) => (
                <tr key={i} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap py-1.5 pr-4 tabular-nums text-zinc-500">
                    {new Date(w.at).toLocaleString("uk-UA", { timeZone: "Europe/Kiev", dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="py-1.5 pr-4 font-medium">{w.sku}</td>
                  <td className="py-1.5 pr-4 tabular-nums">
                    {w.before} → {w.after} г
                  </td>
                  <td className="py-1.5 text-zinc-500">
                    {w.by}
                    {w.control && " · 🔒 контрольна"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
