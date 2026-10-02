// Sends the buyer to WayForPay's payment page: the server signs the form, the
// browser posts it (a full-page navigation).

export interface PaymentForm {
  url: string
  fields: [string, string][]
}

export function submitPaymentForm({ url, fields }: PaymentForm): void {
  const form = document.createElement("form")
  form.method = "POST"
  form.action = url
  form.acceptCharset = "utf-8"
  form.style.display = "none"
  for (const [name, value] of fields) {
    const input = document.createElement("input")
    input.type = "hidden"
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

/** Starts a new payment for an order placed earlier. Resolves to "paid" if it's already paid; throws with a message for the buyer. */
export async function payOrder(id: string): Promise<"redirected" | "paid"> {
  const res = await fetch("/api/payments/wayforpay/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
  const data = await res.json().catch(() => ({}))
  if (data.paid) return "paid"
  if (!res.ok || !data.payment) throw new Error(data.error || "Не вдалося відкрити сторінку оплати. Спробуйте ще раз.")
  submitPaymentForm(data.payment)
  return "redirected"
}
