import { createClient } from "@supabase/supabase-js"

/**
 * Service-role Supabase client. Bypasses RLS — use ONLY in trusted server code
 * (the MCP server) after the caller has been authenticated by a bearer token.
 * Never import this into client components or expose the key to the browser.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
