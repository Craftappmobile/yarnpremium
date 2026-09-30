import fs from "node:fs"
import path from "node:path"
import matter from "gray-matter"

// Blog posts are Markdown files in content/blog/<slug>.md. The file name is the
// URL slug. Posts are read at build time, so every page is static.
//
// Frontmatter:
//   title:   string            (required)
//   date:    YYYY-MM-DD        (required) publication date
//   excerpt: string            short teaser for the list and SEO
//   cover:   string            "/blog/<slug>/cover.jpg" or an https URL
//   tags:    string[]
//   draft:   boolean           true → hidden on the production site

const POSTS_DIR = path.join(process.cwd(), "content", "blog")
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface BlogPost {
  slug: string
  title: string
  date: string
  excerpt: string | null
  cover: string | null
  tags: string[]
  draft: boolean
  content: string
}

// Drafts are visible locally and on Vercel preview deployments (so a post can be
// reviewed in its PR), but never on production.
const showDrafts = process.env.VERCEL_ENV !== "production"

function toDateString(value: unknown): string | null {
  // YAML turns an unquoted 2026-09-30 into a Date object.
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === "string" && DATE_RE.test(value.trim())) return value.trim()
  return null
}

function parsePost(fileName: string): BlogPost {
  const slug = fileName.replace(/\.md$/, "")
  const where = `content/blog/${fileName}`
  if (!SLUG_RE.test(slug)) {
    throw new Error(`${where}: file name must be lowercase latin letters, digits and hyphens (e.g. yak-obraty-pryazhu.md)`)
  }

  const { data, content } = matter(fs.readFileSync(path.join(POSTS_DIR, fileName), "utf8"))

  const title = typeof data.title === "string" ? data.title.trim() : ""
  if (!title) throw new Error(`${where}: "title" is required`)

  const date = toDateString(data.date)
  if (!date) throw new Error(`${where}: "date" is required in YYYY-MM-DD format`)

  if (data.tags !== undefined && !(Array.isArray(data.tags) && data.tags.every((t) => typeof t === "string"))) {
    throw new Error(`${where}: "tags" must be a list of strings`)
  }

  return {
    slug,
    title,
    date,
    excerpt: typeof data.excerpt === "string" && data.excerpt.trim() ? data.excerpt.trim() : null,
    cover: typeof data.cover === "string" && data.cover.trim() ? data.cover.trim() : null,
    tags: (data.tags as string[] | undefined) ?? [],
    draft: data.draft === true,
    content: content.trim(),
  }
}

/** All visible posts, newest first. */
export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(POSTS_DIR)) return []
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map(parsePost)
    .filter((p) => showDrafts || !p.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "uk"))
}

export function getPost(slug: string): BlogPost | null {
  return getAllPosts().find((p) => p.slug === slug) ?? null
}

/** Formats a YYYY-MM-DD date for display in Ukrainian. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Rough reading-time estimate in minutes (Ukrainian ~200 wpm). */
export function readingTime(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}
