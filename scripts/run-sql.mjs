// One-off DDL runner. Reads the non-pooling Postgres URL from
// .env.development.local and executes a .sql file. Usage:
//   node scripts/run-sql.mjs scripts/001_blog_schema.sql
import { readFileSync } from "node:fs"
import postgres from "postgres"

function loadEnv() {
  const raw = readFileSync(".env.development.local", "utf8")
  const env = {}
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    env[m[1]] = val
  }
  return env
}

const env = loadEnv()
const url = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL
if (!url) {
  console.error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL found")
  process.exit(1)
}

const file = process.argv[2]
if (!file) {
  console.error("Usage: node scripts/run-sql.mjs <file.sql>")
  process.exit(1)
}

const sql = readFileSync(file, "utf8")
const client = postgres(url, { max: 1, prepare: false })

try {
  await client.unsafe(sql)
  console.log("[v0] SQL applied:", file)
} catch (err) {
  console.error("[v0] SQL error:", err.message)
  process.exit(1)
} finally {
  await client.end()
}
