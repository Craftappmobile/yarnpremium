// A discount file (.xlsx) to a promotion of a sale (lib/campaigns.ts), checked
// against KeyCRM row by row before anything reaches the site.
//
//   node scripts/promo-import.mjs <file.xlsx> --campaign "Чорна п'ятниця" [--title "Шишибрики 700 м"] [--slug shyshybryky-700] [--whole] [--check]
//
// --whole: the file's yarn is sold only as whole spools while the sale runs.
// --min 500: the file's yarn is sold from 500 г while the sale runs.
// --note "Лімітована партія −50% + {name}": said under the price instead of
// the sale's name, for yarn whose earlier promotion this one lowers further.
//
// The file, as the shop prepares it: one sheet per promotion, with the columns
// «Артикул», «Знижка» (10% or 0.1), «Ціна без знижки», «Ціна зі знижкою».
// Prices of yarn by weight are per 100 г, of the rest per piece. The sheet's
// name (without «10% знижка») names the promotion on the site unless --title
// says otherwise, and one sheet makes one lib/promo-files/<slug>.json.
//
// Every row is checked: the SKU is in KeyCRM, «Ціна без знижки» is the price
// KeyCRM holds, the discount matches the two prices, no SKU is listed twice.
// Any of these wrong and nothing is written. Out-of-stock products are only
// reported. --check reports without writing.
//
// KeyCRM: KEYCRM_API_KEY, or the network proxy adds it; behind a proxy run it
// with NODE_USE_ENV_PROXY=1 (Node's fetch reads HTTPS_PROXY only then).

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { inflateRawSync } from "node:zlib"

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..")
const OUT_DIR = path.join(ROOT, "lib", "promo-files")
const KEYCRM_URL = process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1"

// ---- arguments

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))
const campaign = flag("campaign")
const checkOnly = args.includes("--check")
const wholeOnly = args.includes("--whole")
const note = flag("note")
const minQty = Number(flag("min")) || undefined
if (!file || !campaign) {
  console.error('Usage: node scripts/promo-import.mjs <file.xlsx> --campaign "<name>" [--title "<title>"] [--slug <slug>] [--check]')
  process.exit(2)
}

// ---- .xlsx: a zip of XML parts

function unzip(buf) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error("Not an .xlsx file")
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const files = new Map()
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen)
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(dataAt, dataAt + size)
    files.set(name, method === 8 ? inflateRawSync(raw) : raw)
    at += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const unescapeXml = (s) =>
  s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }[e.toLowerCase()],
  )

const attr = (tag, name) => unescapeXml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "")
const textOf = (xml) => unescapeXml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""))
const columnIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

/** Every sheet as rows of cell values (strings and numbers), in the workbook's order. */
function readWorkbook(buf) {
  const files = unzip(buf)
  const part = (name) => files.get(name)?.toString("utf8") ?? ""
  const shared = [...part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  const rels = new Map(
    [...part("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]),
  )
  return [...part("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const target = rels.get(attr(m[0], "r:id")) ?? ""
    const xml = part(target.startsWith("/") ? target.slice(1) : `xl/${target}`)
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const row = []
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], "r")
        const type = attr(c[1], "t")
        const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        const value = type === "s" ? shared[Number(v)] : type === "inlineStr" ? textOf(c[2] ?? "") : type === "str" ? unescapeXml(v ?? "") : v === undefined ? "" : Number(v)
        row[columnIndex(ref)] = value
      }
      return row
    })
    return { name: attr(m[0], "name"), rows }
  })
}

// ---- KeyCRM

async function keycrm(pathname, params) {
  const url = new URL(KEYCRM_URL + pathname)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.KEYCRM_API_KEY || "proxy"}`, Accept: "application/json" } })
    if (res.status === 429 && attempt < 6) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`KeyCRM ${pathname}: ${res.status} ${await res.text()}`)
    return res.json()
  }
}

/** KeyCRM offers by SKU, with their product. */
async function offersBySku(skus) {
  const found = new Map()
  for (let i = 0; i < skus.length; i += 40) {
    const batch = skus.slice(i, i + 40)
    const page = await keycrm("/offers", { limit: "50", include: "product", "filter[sku]": batch.join(",") })
    for (const o of page.data ?? []) if (batch.includes(o.sku)) found.set(o.sku, o)
  }
  return found
}

async function categoryNames() {
  const names = new Map()
  for (let page = 1; ; page++) {
    const res = await keycrm("/products/categories", { limit: "50", page: String(page) })
    for (const c of res.data ?? []) names.set(c.id, String(c.name ?? "").trim())
    if (!res.next_page_url) return names
  }
}

// ---- the file's rows

const HEADERS = { sku: /^артикул/i, discount: /^знижка/i, regular: /без\s*знижки/i, sale: /зі?\s*знижк/i }

function readSheet(sheet) {
  const header = sheet.rows.findIndex((r) => r.some((c) => typeof c === "string" && HEADERS.sku.test(c.trim())))
  if (header < 0) throw new Error(`«${sheet.name}»: no «Артикул» column`)
  const cols = {}
  sheet.rows[header].forEach((c, i) => {
    const h = String(c ?? "").trim()
    if (HEADERS.sku.test(h)) cols.sku = i
    else if (HEADERS.regular.test(h)) cols.regular = i
    else if (HEADERS.sale.test(h)) cols.sale = i
    else if (HEADERS.discount.test(h)) cols.discount = i
  })
  for (const k of ["sku", "regular", "sale"]) if (cols[k] === undefined) throw new Error(`«${sheet.name}»: no column for ${k}`)
  const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".").replace("%", "")))
  return sheet.rows
    .slice(header + 1)
    .filter((r) => String(r[cols.sku] ?? "").trim())
    .map((r, i) => {
      let discount = cols.discount === undefined ? NaN : num(r[cols.discount])
      if (discount > 1) discount /= 100
      return { line: header + i + 2, sku: String(r[cols.sku]).trim(), discount, regular: num(r[cols.regular]), sale: num(r[cols.sale]) }
    })
}

const LATIN = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia",
}
const slugOf = (s) =>
  [...s.toLowerCase()].map((c) => LATIN[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

const percentOf = (regular, sale) => Math.round((1 - sale / regular) * 1000) / 10

// ---- run

const sheets = readWorkbook(readFileSync(file)).filter((s) => s.rows.length > 1)
if (sheets.length > 1 && (flag("title") || flag("slug"))) {
  console.error("--title and --slug name one promotion: the file has several sheets")
  process.exit(2)
}
const categories = await categoryNames()
// SKUs other discount files already put on sale: one product, one price.
const elsewhere = new Map()
try {
  for (const f of readdirSync(OUT_DIR).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(path.join(OUT_DIR, f), "utf8"))
    for (const sku of Object.keys(data.prices ?? {})) elsewhere.set(sku, { file: f, ...data.prices[sku] })
  }
} catch {}
let failed = false
const results = []

for (const sheet of sheets) {
  const rows = readSheet(sheet)
  const offers = await offersBySku([...new Set(rows.map((r) => r.sku))])
  const errors = []
  const warnings = []
  const seen = new Set()
  const prices = {}
  const cats = new Set()
  const percents = new Set()
  let unit = null

  for (const r of rows) {
    const where = `рядок ${r.line}, ${r.sku}`
    if (seen.has(r.sku)) errors.push(`${where}: артикул повторюється`)
    const other = elsewhere.get(r.sku)
    if (other && other.file !== `${flag("slug") ?? ""}.json`)
      errors.push(`${where}: уже у файлі ${other.file} (${other.regular} → ${other.sale}), а тут ${r.regular} → ${r.sale}`)
    seen.add(r.sku)
    const o = offers.get(r.sku)
    if (!o) {
      errors.push(`${where}: немає в KeyCRM`)
      continue
    }
    if (o.is_archived || o.product?.is_archived) errors.push(`${where}: товар в архіві KeyCRM`)
    const byWeight = String(o.product?.unit_type ?? "").trim().toLowerCase() === "г"
    const rowUnit = byWeight ? "100 г" : "шт"
    if (unit && unit !== rowUnit) errors.push(`${where}: на вагу і поштучні товари в одному аркуші`)
    unit ??= rowUnit
    const keycrmPrice = Math.round(Number(o.price) * (byWeight ? 100 : 1) * 100) / 100
    if (!(r.regular > 0) || !(r.sale > 0)) errors.push(`${where}: немає ціни`)
    else if (r.sale >= r.regular) errors.push(`${where}: ціна зі знижкою ${r.sale} не менша за ${r.regular}`)
    if (r.regular > 0 && Math.abs(r.regular - keycrmPrice) > 0.005)
      errors.push(`${where}: «Ціна без знижки» ${r.regular}, а в KeyCRM ${keycrmPrice} за ${rowUnit}`)
    const actual = percentOf(r.regular, r.sale)
    if (Number.isFinite(r.discount) && Math.abs(actual - r.discount * 100) > 1)
      errors.push(`${where}: знижка ${Math.round(r.discount * 100)}%, а ціни дають ${actual}%`)
    if (Number.isFinite(r.discount)) percents.add(Math.round(r.discount * 100))
    const available = Number(o.quantity ?? 0) - Number(o.in_reserve ?? 0)
    if (available <= 0) warnings.push(`${where}: немає в наявності (${available})`)
    cats.add(categories.get(o.product?.category_id) ?? "")
    // The badge's percent: the file's «Знижка», else what the prices give, in whole percent.
    const skuPercent = Math.round(Number.isFinite(r.discount) ? r.discount * 100 : actual)
    prices[r.sku] = { regular: r.regular, sale: r.sale, percent: skuPercent, name: o.product?.name ?? "", available }
  }

  const title = flag("title") ?? sheet.name.replace(/\s*\d+(?:[.,]\d+)?\s*%.*$/, "").trim()
  const percent = Math.max(...Object.values(prices).map((p) => p.percent))
  if (percents.size > 1) warnings.push(`різні знижки в одному аркуші (${[...percents].join(", ")}%): у кожного товару своя, у фільтрі й банері «до −${percent}%»`)
  const slug = flag("slug") ?? slugOf(title)

  console.log(`\n=== «${sheet.name}» → «${title}» ${percents.size > 1 ? "до " : ""}−${percent}%, ${rows.length} рядків, ціни за ${unit ?? "?"} → lib/promo-files/${slug}.json`)
  console.log(`Категорії KeyCRM: ${[...cats].join(", ") || "—"}`)
  console.log("Артикул      Було   Стало  Знижка  Бейдж  В наявності  Назва")
  for (const [sku, p] of Object.entries(prices))
    console.log(
      `${sku.padEnd(12)} ${String(p.regular).padStart(5)}  ${String(p.sale).padStart(5)}  ${`${percentOf(p.regular, p.sale)}%`.padStart(6)}  ${`−${p.percent}%`.padStart(5)}  ${String(p.available).padStart(11)}  ${p.name}`,
    )
  for (const w of warnings) console.log(`  увага: ${w}`)
  for (const e of errors) console.log(`  ПОМИЛКА: ${e}`)
  if (errors.length) failed = true
  results.push({
    slug,
    data: {
      campaign,
      title,
      category: [...cats][0] ?? "",
      percent,
      per: unit ?? "100 г",
      source: `${path.basename(file)} / ${sheet.name}`,
      checkedAt: new Date().toISOString(),
      ...(wholeOnly ? { wholeOnly: true } : {}),
      ...(note ? { note } : {}),
      ...(minQty ? { minQty } : {}),
      prices: Object.fromEntries(
        Object.entries(prices).map(([sku, p]) => [sku, { regular: p.regular, sale: p.sale, percent: p.percent }]),
      ),
    },
  })
}

if (failed) {
  console.error("\nЄ помилки: нічого не записано.")
  process.exit(1)
}
if (checkOnly) {
  console.log("\n--check: усе гаразд, нічого не записано.")
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
for (const r of results) writeFileSync(path.join(OUT_DIR, `${r.slug}.json`), `${JSON.stringify(r.data, null, 2)}\n`)

// The index lib/promo.ts reads: every file in the folder.
const all = readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).sort()
const ident = (f) => `f_${f.replace(/\.json$/, "").replace(/[^a-zA-Z0-9]/g, "_")}`
writeFileSync(
  path.join(OUT_DIR, "index.ts"),
  [
    "// Written by scripts/promo-import.mjs: every discount file in this folder.",
    'import type { PromoFile } from "@/lib/promo"',
    ...all.map((f) => `import ${ident(f)} from "./${f}"`),
    "",
    `export const PROMO_FILES: PromoFile[] = [${all.map(ident).join(", ")}]`,
    "",
  ].join("\n"),
)
console.log(`\nЗаписано: ${results.map((r) => `lib/promo-files/${r.slug}.json`).join(", ")}`)
