import Link from "next/link"
import { sitePages } from "./site-content"

// Посилання беруться напряму зі сторінок контенту, тож футер завжди синхронний
const links = [
  { label: "Журнал", href: "/blog" },
  ...sitePages.map((page) => ({ label: page.navLabel, href: `/${page.slug}` })),
]

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-[1400px] px-4 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-900 dark:text-zinc-100">
            SINSERITA
          </Link>

          <nav aria-label="Інформація про магазин">
            <ul className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-zinc-600 dark:text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {"© "}
            {new Date().getFullYear()} SINSERITA. Усі права захищено.
          </p>
        </div>
      </div>
    </footer>
  )
}
