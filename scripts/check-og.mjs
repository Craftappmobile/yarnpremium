// Run before every build (package.json "prebuild"): a page that sets its own
// Open Graph tags must do it through openGraph() from lib/og.ts, or its link
// previews lose og:type, og:site_name and og:locale (Next.js replaces the
// layout's tags instead of merging them).

import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "app")
const bad = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) walk(file)
    else if (/\.(tsx?|jsx?)$/.test(name) && /\bopenGraph\s*:\s*\{/.test(readFileSync(file, "utf8"))) bad.push(file)
  }
}
walk(root)

if (bad.length) {
  console.error("Open Graph: use openGraph({ … }) from lib/og.ts instead of openGraph: { … } in")
  for (const f of bad) console.error(`  ${path.relative(process.cwd(), f)}`)
  process.exit(1)
}
