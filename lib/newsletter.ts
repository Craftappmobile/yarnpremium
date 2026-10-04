// Server-only: buyers who ticked «Надсилати мені нові кольори» at checkout go
// to the shop's contacts in Resend, where new-colour letters are sent from
// (Broadcasts; Resend adds the unsubscribe link). Nobody is added without
// that tick.
//
// Settings: RESEND_API_KEY. RESEND_AUDIENCE_ID is optional: with it the
// contact goes to that audience; without it, to the account's contacts (newer
// Resend accounts have a single default audience and no audience menu).

export function newsletterConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function subscribe(contact: { email: string; firstName: string; lastName: string }): Promise<void> {
  if (!newsletterConfigured()) {
    console.warn("[newsletter] RESEND_API_KEY is not set; not subscribed:", contact.email)
    return
  }
  const audience = process.env.RESEND_AUDIENCE_ID?.trim()
  const url = audience
    ? `https://api.resend.com/audiences/${encodeURIComponent(audience)}/contacts`
    : "https://api.resend.com/contacts"
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: contact.email,
      first_name: contact.firstName || undefined,
      last_name: contact.lastName || undefined,
      unsubscribed: false,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Resend: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
}
