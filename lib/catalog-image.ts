import { SITE_URL } from "@/lib/site"

// Product photos for the Meta catalog. They live in KeyCRM's file storage,
// whose robots.txt turns every crawler away (Disallow: /), so Meta's image
// crawler fetched only a few of them. The feed lists the shop's own copy
// instead, app/catalog-img, which passes the same file through.

const KEYCRM_FILES = "https://sincerita.api.keycrm.app/file-storage/"

/** Paths of KeyCRM's uploads and their thumbnails, e.g. thumbnails/sincerita/uploads/2026-09-30/P06R….jpg */
const FILE_PATH = /^(?:thumbnails\/)?sincerita\/uploads\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{8,80}\.(?:jpe?g|png|webp)$/i

/** The address of a KeyCRM photo on the shop's domain; any other address unchanged. */
export function catalogImageUrl(url: string): string {
  if (!url.startsWith(KEYCRM_FILES)) return url
  const path = url.slice(KEYCRM_FILES.length)
  return FILE_PATH.test(path) ? `${SITE_URL}/catalog-img/${path}` : url
}

/** KeyCRM's address of a photo path served by app/catalog-img, or null for anything else. */
export function keycrmFileUrl(path: string): string | null {
  return FILE_PATH.test(path) ? `${KEYCRM_FILES}${path}` : null
}
