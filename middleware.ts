import { type NextRequest, NextResponse } from "next/server"
import { categoryPath } from "@/lib/category-url"

// Links from before categories had their own pages (/?category=Мериноси тонкі,
// in ads, posts and bookmarks): to the category's page, keeping the rest of
// the query (utm_*, fbclid) so the ad still gets the visit.
export function middleware(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category")?.trim()
  if (!category) return NextResponse.next()
  const url = req.nextUrl.clone()
  url.pathname = categoryPath(category)
  url.searchParams.delete("category")
  return NextResponse.redirect(url, 308)
}

export const config = { matcher: "/" }
