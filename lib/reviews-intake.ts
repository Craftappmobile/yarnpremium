// Server-only: reviews from the staff group's «Відгуки» topic in Telegram go to
// the site by themselves (lib/reviews.ts).
//
// A manager posts a screenshot of the buyer's message, photos of the finished
// item if the buyer sent any, and a link to the product or its SKU, in one
// message or a few. The webhook keeps every message of the topic
// (`captureReviewMessage`); a few minutes after the last one, the cron
// (`processReviews`) gives each manager's messages to Claude, which picks out
// the buyer's words and first name, and which photos show the item rather than
// the chat. The review is published at once, and the bot answers in the topic
// with what it published and how to correct it (complaints are not published:
// the bot says so):
//   reply to the bot with a link or SKU      — another product
//   reply to the bot with /review_delete     — off the site
//
// The screenshots never leave the group and Claude: only the buyer's words,
// «Ім'я П.» and the item photos are published.
//
// The topic is the one where someone wrote «/reviews_here <code>» (the code
// is lib/telegram-staff.ts's, shown on /admin/telegram).
//
// Redis keys:
//   rv:topic             JSON  { chatId, threadId?, title, at }
//   rv:pending           list  PendingMessage JSON, oldest first
//   rv:pending_at        ms of the last message added
//   rv:lock              held while the cron works on them
//   rv:msg:<chat>:<id>   review id of a topic message (the manager's or the bot's answer)
//   rv:photo:<id>        Telegram file id of a published photo (app/review-photo)

import Anthropic from "@anthropic-ai/sdk"
import sharp from "sharp"
import type { Product } from "@/components/shop/data"
import { readCatalog } from "@/lib/catalog"
import { redis } from "@/lib/redis"
import { type Review, type ReviewPhoto, deleteReview, matchProducts, readReview, saveReview } from "@/lib/reviews"
import { SITE_URL } from "@/lib/site"
import { staffCode } from "@/lib/telegram-staff"
import { TelegramError, esc, tg, tgFile } from "@/lib/telegram"

const KEY_TOPIC = "rv:topic"
const KEY_PENDING = "rv:pending"
const KEY_PENDING_AT = "rv:pending_at"
const KEY_LOCK = "rv:lock"
const keyMsg = (chatId: number, messageId: number) => `rv:msg:${chatId}:${messageId}`
export const keyPhoto = (id: string) => `rv:photo:${id}`
const KEEP = 400 * 86400

/** A manager's messages are taken once none came for this long: an album and its caption arrive one by one. */
const QUIET_MS = 2 * 60_000
/** Photos per model call. */
const MAX_PHOTOS = 16
/** A batch the model couldn't read is tried this many times. */
const ATTEMPTS = 3
/** Of the cron's 300 seconds: no new batch is started after this. */
const BUDGET_MS = 120_000

const MODEL = process.env.REVIEWS_MODEL || "claude-opus-5-5"
/** Models that take the server-side refusal fallback. */
const CURRENT_MODEL = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODEL)

export interface ReviewsTopic {
  chatId: number
  threadId?: number
  title: string
  at: string
}

interface PendingPhoto {
  fileId: string
  uniqueId: string
  w: number
  h: number
}

interface PendingMessage {
  chatId: number
  threadId?: number
  messageId: number
  fromId: number
  /** Unix seconds. */
  date: number
  text: string
  photo?: PendingPhoto
  attempts?: number
}

export async function readReviewsTopic(): Promise<ReviewsTopic | null> {
  const raw = await (await redis()).get(KEY_TOPIC)
  return raw ? JSON.parse(raw) : null
}

const inThread = (threadId?: number) => (threadId ? { message_thread_id: threadId } : {})

function replyTo(chatId: number, threadId: number | undefined, messageId: number, text: string) {
  return tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    ...inThread(threadId),
    text,
    parse_mode: "HTML",
    reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  })
}

/** The biggest photo Telegram keeps of it (or an image sent as a file). */
function photoOf(message: any): PendingPhoto | undefined {
  const sizes: any[] = message.photo ?? []
  const best = sizes.reduce((a, b) => (!a || b.width * b.height > a.width * a.height ? b : a), null)
  if (best) return { fileId: best.file_id, uniqueId: best.file_unique_id, w: best.width, h: best.height }
  const doc = message.document
  if (doc && /^image\/(jpeg|png|webp)$/.test(doc.mime_type ?? "") && (doc.file_size ?? 0) <= 15_000_000) {
    return { fileId: doc.file_id, uniqueId: doc.file_unique_id, w: 0, h: 0 }
  }
  return undefined
}

/**
 * Group messages: «/reviews_here <code>» and «/reviews_off <code>» anywhere,
 * and everything posted in the reviews topic. True when the message was
 * dealt with here, so nothing else answers it.
 */
export async function handleReviewsMessage(message: any): Promise<boolean> {
  const text = String(message.text ?? message.caption ?? "").trim()
  const chatId: number = message.chat.id
  const threadId: number | undefined = message.is_topic_message ? message.message_thread_id : undefined
  const r = await redis()

  const command = text.match(/^\/(reviews_here|reviews_off)(?:@\w+)?(?:\s+(\S+))?/)
  if (command) {
    const reply = (t: string) => tg("sendMessage", { chat_id: chatId, ...inThread(threadId), text: t, parse_mode: "HTML" })
    if (command[2] !== staffCode()) {
      await reply("Потрібен код зі сторінки статистики Telegram на сайті: /reviews_here КОД")
      return true
    }
    if (command[1] === "reviews_off") {
      await r.del(KEY_TOPIC)
      await reply("Відгуки з цієї гілки більше не потрапляють на сайт. Уже опубліковані залишаються.")
      return true
    }
    const topicName = message.reply_to_message?.forum_topic_created?.name
    const title = [message.chat.title, topicName].filter(Boolean).join(" → ") || String(chatId)
    const topic: ReviewsTopic = { chatId, ...(threadId ? { threadId } : {}), title, at: new Date().toISOString() }
    await r.set(KEY_TOPIC, JSON.stringify(topic))
    await reply(
      [
        "✅ Відгуки з цієї гілки тепер самі з'являються на сайті: на картці товару і на сторінці «Відгуки».",
        "",
        "<b>Як публікувати</b>",
        "1. Скриншот повідомлення покупця. Є фото готового виробу — додайте і його.",
        "2. У підписі чи наступним повідомленням — посилання на товар на сайті або артикул.",
        "",
        "За кілька хвилин я відповім, що опублікував. На сайт іде лише текст покупця, ім'я з першою літерою прізвища і фото виробу — не скриншот.",
      ].join("\n"),
    )
    return true
  }

  const topic = await readReviewsTopic()
  if (!topic || topic.chatId !== chatId || (topic.threadId ?? undefined) !== threadId) return false
  if (message.from?.is_bot) return true

  // In a topic every message «replies» to the topic's first message; only a real reply counts.
  const replied = message.reply_to_message?.forum_topic_created ? undefined : message.reply_to_message
  const reviewId = replied ? await r.get(keyMsg(chatId, replied.message_id)) : null

  if (/^\/review_delete\b/.test(text)) {
    if (!reviewId) {
      await replyTo(chatId, threadId, message.message_id, "Відповідайте /review_delete на моє повідомлення про відгук, який треба прибрати.")
      return true
    }
    await removeReview(reviewId, topic)
    await replyTo(chatId, threadId, message.message_id, "🗑 Прибрав цей відгук із сайту.")
    return true
  }

  // A reply to the bot's report or to the review's own message, with words only: the review is about another product.
  if (reviewId && text && !photoOf(message)) {
    await correctProducts(reviewId, text, topic, message.message_id)
    return true
  }

  const photo = photoOf(message)
  if (!text && !photo) return true
  const pending: PendingMessage = {
    chatId,
    ...(threadId ? { threadId } : {}),
    messageId: message.message_id,
    fromId: message.from?.id ?? 0,
    date: message.date,
    text: text.slice(0, 4000),
    ...(photo ? { photo } : {}),
  }
  await r.multi().rPush(KEY_PENDING, JSON.stringify(pending)).set(KEY_PENDING_AT, String(Date.now())).exec()
  return true
}

// ---------------------------------------------------------------------------
// Claude reads the screenshots

const SYSTEM = `You read posts from the private staff chat of SINCERITA, a Ukrainian online shop of Italian premium yarn. In the «Відгуки» topic managers post buyers' feedback: screenshots of the buyer's messages (Instagram, Viber, Telegram), photos of finished knitted items or of the yarn, and usually the product: a link to yarnpremium.com.ua, an SKU like «MER167-5» or a name like «Сток Burberry Меринос New Geelong M500 1500м». Sometimes a KeyCRM conversation link; it is internal.

The reviews you find are published on the shop's product pages. For each review, give:

- message_ids: the ids of the messages it is made of. One review is usually one screenshot or album plus the manager's caption or next message. Messages of one manager in a row can hold several reviews (different buyers or products): split them.
- text: the buyer's own words from the screenshots, as the buyer wrote them, in the buyer's language. Join a buyer's consecutive messages into one text with line breaks. Leave out the shop's replies, the manager's words, greetings or questions that are not feedback, and anything personal: phone numbers, addresses, Nova Poshta branches and tracking numbers, order numbers, sums paid, e-mails, usernames, other people's names. Fix nothing else; keep emoji. At most about 700 characters: cut whole sentences.
- author: the buyer's first name and the first letter of the surname with a dot, as the chat shows it («Олена К.», «Olena K.»), or the first name alone if that is all there is. Empty when the chat shows only a nickname, a username or nothing.
- item_photos: the labels («P1», «P3») of photos that show a knitted item, a work in progress or the yarn itself, as a photo of its own. Never a screenshot of a chat or of any app, even if the screenshot contains such a photo. A buyer wearing the item counts: buyers send these photos to be shown.
- product_mentions: every link, SKU, article and product name the manager wrote or the screenshots show, copied exactly.
- product_title: the yarn as the manager named it, short («Меринос 100% Cashwool», «Кашемір шовк Jaipur»); empty if not named.
- category: the shop category the yarn belongs to, from the list in the schema; empty if unclear.
- negative: true when the buyer is mainly complaining or disappointed (the colour isn't what they expected, the yarn pricks, sheds, stains, the quality isn't worth the price). Mostly praise with a small «but» is not negative. Negative reviews are not published; the shop deals with them.

A post is a review only if the buyer says what they think of the yarn, the item, the order or the shop. A screenshot of a question, an order or a delivery detail without such words is not one. If nothing is a review, return an empty list.`

function schema(categories: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reviews"],
    properties: {
      reviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["message_ids", "author", "text", "item_photos", "product_mentions", "product_title", "category", "negative"],
          properties: {
            message_ids: { type: "array", items: { type: "integer" } },
            author: { type: "string" },
            text: { type: "string" },
            item_photos: { type: "array", items: { type: "string" } },
            product_mentions: { type: "array", items: { type: "string" } },
            product_title: { type: "string" },
            category: { type: "string", enum: [...new Set(["", ...categories])] },
            negative: { type: "boolean" },
          },
        },
      },
    },
  }
}

export interface Extracted {
  message_ids: number[]
  author: string
  text: string
  item_photos: string[]
  product_mentions: string[]
  product_title: string
  category: string
  negative: boolean
}

/** A post as Claude reads it: its words and its photos, already downloaded. */
export interface PostForReading {
  id: number
  /** «19.10.2026» */
  date: string
  text: string
  /** JPEG, at most 1568 px a side. */
  photo?: Buffer
}

/** Thrown when the model declined or its answer can't be used: trying again won't help. */
export class UnreadableError extends Error {}

let client: Anthropic | null = null

/** One manager's messages in a row -> the reviews in them. Photos are labelled P1, P2… in order. */
export async function extractReviews(posts: PostForReading[], categories: string[]): Promise<Extracted[]> {
  client ??= new Anthropic()
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  let n = 0
  for (const post of posts) {
    const label = post.photo ? `P${++n}` : ""
    content.push({
      type: "text",
      text: `Повідомлення #${post.id} (${post.date})${label ? `, фото ${label}` : ""}${post.text ? `:\n${post.text}` : ""}`,
    })
    if (post.photo) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: post.photo.toString("base64") } })
    }
  }
  const response = await client.beta.messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: schema(categories) } },
      ...(CURRENT_MODEL && {
        // A safety decline is retried on another model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
      }),
    },
    // Within the cron's 300 seconds even for the last batch it starts.
    { timeout: 150_000, maxRetries: 1 },
  )
  if (response.stop_reason === "refusal") throw new UnreadableError("the model declined")
  if (response.stop_reason === "max_tokens") throw new UnreadableError("the answer was cut off")
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
  try {
    return (JSON.parse(text) as { reviews: Extracted[] }).reviews
  } catch {
    throw new UnreadableError("the answer is not JSON")
  }
}

/** A photo for Claude: upright, JPEG, at most 1568 px a side (what the model reads anyway). */
export async function forReading(data: Buffer): Promise<{ jpeg: Buffer; w: number; h: number }> {
  const meta = await sharp(data).rotate().metadata()
  const jpeg = await sharp(data)
    .rotate()
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  const turned = (meta.orientation ?? 1) >= 5
  return { jpeg, w: (turned ? meta.height : meta.width) ?? 0, h: (turned ? meta.width : meta.height) ?? 0 }
}

// ---------------------------------------------------------------------------
// The cron: pending messages -> reviews on the site

export const kyivDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("uk-UA", { timeZone: "Europe/Kiev", day: "2-digit", month: "2-digit", year: "numeric" })

/** Splits one manager's messages into model calls of at most MAX_PHOTOS photos, an album kept whole where it can be. */
function chunks(messages: PendingMessage[]): PendingMessage[][] {
  const out: PendingMessage[][] = [[]]
  for (const m of messages) {
    const last = out[out.length - 1]
    if (m.photo && last.filter((x) => x.photo).length >= MAX_PHOTOS) out.push([m])
    else last.push(m)
  }
  return out.filter((c) => c.length)
}

function report(review: Review): string {
  const productUrl = review.skus[0] ? `${SITE_URL}/product/${encodeURIComponent(review.skus[0])}` : null
  const quote = review.text.length > 160 ? `${review.text.slice(0, 157).trimEnd()}…` : review.text
  const lines = [
    `✅ <b>Відгук на сайті</b>${review.author ? ` — ${esc(review.author)}` : ""}`,
    `«${esc(quote)}»`,
    "",
  ]
  if (productUrl) {
    lines.push(`Товар: <a href="${productUrl}">${esc(review.about)}</a>${review.line ? " і всі кольори цієї пряжі" : ""}`)
  } else if (review.line || review.category) {
    lines.push(
      `Товару ${review.about ? `«${esc(review.about)}» ` : ""}немає в каталозі: показую на картках ${
        review.line ? "цієї пряжі" : `категорії «${esc(review.category)}»`
      }.`,
    )
  } else {
    lines.push("⚠️ Не впізнав товар: відгук лише на сторінці «Відгуки». Відповідайте посиланням чи артикулом — додам на картку.")
  }
  lines.push(review.photos.length ? `📷 Фото виробу: ${review.photos.length}` : "Без фото виробу.")
  lines.push("", "<i>Інший товар — відповідайте на це повідомлення посиланням або артикулом. Прибрати — відповідайте /review_delete</i>")
  return lines.join("\n")
}

async function publish(
  found: Extracted,
  batch: PendingMessage[],
  labels: Map<string, { message: PendingMessage; w: number; h: number }>,
  catalog: Product[],
): Promise<Review | "negative" | null> {
  const ids = found.message_ids.filter((id) => batch.some((m) => m.messageId === id)).sort((a, b) => a - b)
  const text = found.text.trim()
  if (!ids.length || !text) return null
  const first = batch.find((m) => m.messageId === ids[0])!
  // The owner's choice: complaints stay in the group, for the shop to deal with.
  if (found.negative) {
    await replyTo(
      first.chatId,
      first.threadId,
      first.messageId,
      `🙈 Це негативний відгук, на сайт його не публікую.\n«${esc(text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text)}»`,
    ).catch(() => {})
    return "negative"
  }
  const photos: ReviewPhoto[] = []
  const r = await redis()
  for (const label of found.item_photos) {
    const p = labels.get(label)
    if (!p?.message.photo || photos.some((x) => x.id === p.message.photo!.uniqueId)) continue
    photos.push({ id: p.message.photo.uniqueId, w: p.w, h: p.h })
    await r.set(keyPhoto(p.message.photo.uniqueId), p.message.photo.fileId)
  }
  const mentions = [...found.product_mentions, ...batch.filter((m) => ids.includes(m.messageId)).map((m) => m.text)]
  const match = matchProducts(mentions, catalog, found.category, found.product_title)
  const review: Review = {
    id: `tg-${Math.abs(first.chatId)}-${first.messageId}`,
    at: new Date(first.date * 1000).toISOString(),
    author: found.author.trim().slice(0, 40),
    text: text.slice(0, 1200),
    photos,
    ...match,
    source: { chatId: first.chatId, messageIds: ids },
  }
  await saveReview(review, catalog)
  const sent = await replyTo(first.chatId, first.threadId, first.messageId, report(review)).catch((e: Error) => {
    console.error("[reviews] report failed:", e.message)
    return null
  })
  if (sent) {
    review.source!.replyId = sent.message_id
    await saveReview(review, catalog)
  }
  const m = r.multi()
  for (const id of [...ids, ...(sent ? [sent.message_id] : [])]) m.set(keyMsg(first.chatId, id), review.id, { EX: KEEP })
  await m.exec()
  return review
}

/** One manager's messages in a row: read, published, reported. */
async function processBatch(batch: PendingMessage[], catalog: Product[], categories: string[]): Promise<number> {
  const posts: PostForReading[] = []
  const labels = new Map<string, { message: PendingMessage; w: number; h: number }>()
  for (const m of batch) {
    let photo: Buffer | undefined
    if (m.photo) {
      const read = await forReading((await tgFile(m.photo.fileId)).data)
      photo = read.jpeg
      labels.set(`P${labels.size + 1}`, { message: m, w: m.photo.w || read.w, h: m.photo.h || read.h })
    }
    posts.push({ id: m.messageId, date: kyivDate(m.date), text: m.text, ...(photo ? { photo } : {}) })
  }
  const found = await extractReviews(posts, categories)
  let published = 0
  let negative = 0
  for (const f of found) {
    const done = await publish(f, batch, labels, catalog)
    if (done === "negative") negative++
    else if (done) published++
  }
  if (published === 0 && negative === 0 && batch.some((m) => m.photo)) {
    const first = batch[0]
    await replyTo(
      first.chatId,
      first.threadId,
      first.messageId,
      "🤔 Не знайшов тут відгуку покупця, тож нічого не опублікував. Якщо він тут є, перешліть скриншот ще раз з посиланням на товар.",
    ).catch(() => {})
  }
  return published
}

export interface ReviewsRun {
  waiting?: boolean
  messages?: number
  published?: number
  failed?: number
  postponed?: number
}

/** Run by the cron: the topic's messages that have settled become reviews. */
export async function processReviews(): Promise<ReviewsRun> {
  const r = await redis()
  if ((await r.lLen(KEY_PENDING)) === 0) return { messages: 0 }
  if (Date.now() - Number((await r.get(KEY_PENDING_AT)) ?? 0) < QUIET_MS) return { waiting: true }
  const token = crypto.randomUUID()
  if (!(await r.set(KEY_LOCK, token, { NX: true, EX: 290 }))) return { waiting: true }
  const started = Date.now()
  const run: ReviewsRun = { messages: 0, published: 0, failed: 0, postponed: 0 }
  try {
    const raw = await r.lRange(KEY_PENDING, 0, -1)
    // Messages that arrive meanwhile are pushed after these and stay.
    await r.lTrim(KEY_PENDING, raw.length, -1)
    const messages: PendingMessage[] = raw.map((j) => JSON.parse(j))
    run.messages = messages.length
    if (!messages.length) return run

    const catalog = await readCatalog()
    const categories = [...new Set(catalog.map((p) => p.category).filter(Boolean))]
    const byManager = new Map<number, PendingMessage[]>()
    for (const m of messages.sort((a, b) => a.messageId - b.messageId)) {
      byManager.set(m.fromId, [...(byManager.get(m.fromId) ?? []), m])
    }
    const later: PendingMessage[] = []
    for (const batch of [...byManager.values()].flatMap(chunks)) {
      if (Date.now() - started > BUDGET_MS) {
        later.push(...batch)
        run.postponed! += batch.length
        continue
      }
      try {
        run.published! += await processBatch(batch, catalog, categories)
      } catch (e) {
        run.failed! += batch.length
        const attempts = (batch[0].attempts ?? 0) + 1
        const final = e instanceof UnreadableError || attempts >= ATTEMPTS
        console.error(`[reviews] batch of ${batch.length} failed (attempt ${attempts}):`, (e as Error).message)
        if (!final) later.push(...batch.map((m) => ({ ...m, attempts })))
        else {
          const first = batch[0]
          await replyTo(
            first.chatId,
            first.threadId,
            first.messageId,
            "⚠️ Не вдалося розібрати ці повідомлення, на сайт нічого не пішло. Спробуйте надіслати скриншот ще раз.",
          ).catch(() => {})
        }
      }
    }
    if (later.length) {
      // Back in front of anything newer, to be taken with the next run.
      await r.lPush(KEY_PENDING, later.reverse().map((m) => JSON.stringify(m)))
    }
    return run
  } finally {
    if ((await r.get(KEY_LOCK)) === token) await r.del(KEY_LOCK)
  }
}

// ---------------------------------------------------------------------------
// Corrections from the topic

async function removeReview(id: string, topic: ReviewsTopic) {
  const review = await deleteReview(id, await readCatalog())
  const r = await redis()
  if (review) for (const p of review.photos) await r.del(keyPhoto(p.id))
  if (review?.source?.replyId) {
    await tg("editMessageText", {
      chat_id: topic.chatId,
      message_id: review.source.replyId,
      text: `🗑 Прибрано з сайту: «${esc(review.text.slice(0, 120))}${review.text.length > 120 ? "…" : ""}»`,
      parse_mode: "HTML",
    }).catch(() => {})
  }
}

async function correctProducts(id: string, text: string, topic: ReviewsTopic, messageId: number) {
  const review = await readReview(id)
  if (!review) {
    await replyTo(topic.chatId, topic.threadId, messageId, "Цього відгуку на сайті вже немає.")
    return
  }
  const catalog = await readCatalog()
  const match = matchProducts([text], catalog, "", "")
  if (!match.skus.length && !match.line && !match.category) {
    await replyTo(
      topic.chatId,
      topic.threadId,
      messageId,
      "Не знайшов такого товару. Надішліть посилання на його сторінку на сайті або артикул, як-от MER167-5.",
    )
    return
  }
  const next: Review = { ...review, ...match, about: match.about || review.about }
  await saveReview(next, catalog)
  if (next.source?.replyId) {
    await tg("editMessageText", {
      chat_id: topic.chatId,
      message_id: next.source.replyId,
      text: report(next),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }).catch((e) => {
      if (!(e instanceof TelegramError && /not modified/i.test(e.description))) throw e
    })
  }
  await replyTo(topic.chatId, topic.threadId, messageId, `👌 Тепер відгук на картці: ${esc(next.about || next.category)}`)
}
