import { type NextRequest, NextResponse } from "next/server"
import { readResult, recordApprovedPayment, verifyResult, type PaymentResult } from "@/lib/wayforpay"

// WayForPay's returnUrl: the buyer comes back here (by POST) from the payment
// page. Books an approved payment right away, in case the serviceUrl call is
// slower, and shows the order page with the outcome.
export const dynamic = "force-dynamic"

function outcome(result: PaymentResult | null): "ok" | "pending" | "fail" {
  if (!result || !verifyResult(result)) return "pending"
  if (result.transactionStatus === "Approved") return "ok"
  if (["Pending", "InProcessing", "WaitingAuthComplete"].includes(result.transactionStatus ?? "")) return "pending"
  return "fail"
}

async function handle(req: NextRequest, result: PaymentResult | null) {
  const status = outcome(result)
  if (status === "ok") {
    await recordApprovedPayment(result!).catch((e) => console.error("[wayforpay] return booking failed:", (e as Error).message))
  }
  const to = new URL("/checkout/success", req.nextUrl.origin)
  to.searchParams.set("payment", status)
  const order = req.nextUrl.searchParams.get("order")
  if (order) to.searchParams.set("order", order)
  // 303: the browser follows with a GET.
  return NextResponse.redirect(to, 303)
}

export async function POST(req: NextRequest) {
  return handle(req, await readResult(req).catch(() => null))
}

export async function GET(req: NextRequest) {
  return handle(req, null)
}
