import { updateSession } from "@/lib/supabase/proxy"
import type { NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and the MCP API route
     * (the MCP server authenticates via bearer token, not Supabase cookies).
     */
    "/((?!_next/static|_next/image|favicon.ico|api/mcp|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
