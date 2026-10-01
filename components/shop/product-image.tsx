import Image, { type ImageProps } from "next/image"

/**
 * KeyCRM photos (~130 KB each) go through Vercel Image Optimization: resized to
 * the slot (`sizes`) and served as WebP. Anything else — the placeholder, a
 * photo on another host — is shown as is, since only KeyCRM's host is allowed
 * in next.config.mjs.
 */
const OPTIMIZABLE = /^https:\/\/sincerita\.api\.keycrm\.app\/file-storage\//

export function ProductImage({ src, ...props }: Omit<ImageProps, "src"> & { src: string }) {
  const url = src || "/placeholder.svg"
  return <Image src={url} unoptimized={!OPTIMIZABLE.test(url)} {...props} />
}
