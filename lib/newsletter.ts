// Server-only: buyers who ticked «Надсилати мені нові кольори» at checkout go
// to the shop's audience in Resend, where new-colour letters are sent from
// (Broadcasts; Resend adds the unsubscribe link). Nobody is added without
// that tick.
//
// Settings: RESEND_API_KEY and RESEND_AUDIENCE_ID (Resend → Audiences).

export function newsletterConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_AUDIENCE_ID)
}

export async function subscribe(contact: { email: string; firstName: string; lastName: string }): Promise<void> {
  if (!newsletterConfigured()) {
    console.warn("[newsletter] RESEND_API_KEY or RESEND_AUDIENCE_ID is not set; not subscribed:", contact.email)
    return
  }
  const res = await fetch(`https://api.resend.com/audiences/${encodeURIComponent(process.env.RESEND_AUDIENCE_ID!)}/contacts`, {
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
