import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Mail, Phone, MapPin } from "lucide-react"
import { sitePages, getSitePage, type ContentSection } from "@/components/shop/site-content"

// Лише відомі сторінки з site-content.ts, інші URL → 404
export const dynamicParams = false

export function generateStaticParams() {
  return sitePages.map((page) => ({ slug: page.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const page = getSitePage(slug)
  if (!page) return {}
  return {
    // metaTitle already ends with the brand.
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: { canonical: `/${page.slug}` },
    openGraph: { title: page.metaTitle, description: page.metaDescription, url: `/${page.slug}` },
  }
}

function Section({ section }: { section: ContentSection }) {
  const body = (
    <>
      {section.heading && (
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{section.heading}</h2>
      )}

      {section.blocks?.map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i} className="leading-relaxed text-pretty text-zinc-600 dark:text-zinc-400">
            {block.text}
          </p>
        ) : (
          <ul key={i} className="space-y-2 pl-1">
            {block.items.map((item) => (
              <li key={item} className="flex gap-3 leading-relaxed text-zinc-600 dark:text-zinc-400">
                <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ),
      )}

      {section.contacts && (
        <ul className="space-y-3 text-zinc-600 dark:text-zinc-400">
          {section.contacts.address && (
            <li className="flex items-start gap-3">
              <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-500" />
              <span className="leading-relaxed">
                {section.contacts.address.map((line, i) => (
                  <span key={line}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </span>
            </li>
          )}
          {section.contacts.email && (
            <li className="flex items-center gap-3">
              <Mail aria-hidden className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-500" />
              <a
                href={`mailto:${section.contacts.email}`}
                className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {section.contacts.email}
              </a>
            </li>
          )}
          {section.contacts.phone && (
            <li className="flex items-center gap-3">
              <Phone aria-hidden className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-500" />
              <a
                href={`tel:${section.contacts.phoneHref ?? section.contacts.phone}`}
                className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {section.contacts.phone}
              </a>
            </li>
          )}
        </ul>
      )}
    </>
  )

  if (section.card) {
    return <section className="space-y-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">{body}</section>
  }
  return <section className="space-y-3">{body}</section>
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = getSitePage(slug)
  if (!page) notFound()

  return (
    <main id="content" className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          До магазину
        </Link>

        <header className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500">
            SINCERITA
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 text-balance dark:text-zinc-50 md:text-4xl">
            {page.title}
          </h1>
        </header>

        <div className="mt-10 space-y-10">
          {page.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </div>
      </div>
    </main>
  )
}
