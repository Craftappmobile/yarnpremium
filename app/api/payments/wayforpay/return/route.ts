import { type NextRequest, NextResponse } from "next/server"
import { paymentStatus, readResult, recordApprovedPayment, verifyResult, type PaymentResult } from "@/lib/wayforpay"

// WayForPay's returnUrl: the buyer comes back here (usually by POST) from the
// payment page and is shown the order page with the outcome. The outcome comes
// from the signed data posted back if it checks out, else from what WayForPay
// reported to serviceUrl or answers to CHECK_STATUS. An approved payment is
// booked here too, in case the serviceUrl call is slower.
export const dynamic = "force-dynamic"

function outcome(result: PaymentResult | null): "ok" | "pending" | "fail" {
  const status = result?.transactionStatus ?? ""
  if (status === "Approved") return "ok"
  if (!status || ["Pending", "InProcessing", "WaitingAuthComplete", "Created"].includes(status)) return "pending"
  return "fail"
}

async function handle(req: NextRequest, posted: PaymentResult | null) {
  const ref = posted?.orderReference || req.nextUrl.searchParams.get("ref") || ""
  const signed = !!posted && !!verifyResult(posted)
  let result: PaymentResult | null = signed ? posted : null
  if (!result && ref) {
    result = await paymentStatus(ref).catch((e) => {
      console.error(`[wayforpay] return ${ref}: status check failed:`, (e as Error).message)
      return null
    })
  }
  console.log(
    `[wayforpay] return ${ref || "(no reference)"}: ${result?.transactionStatus ?? "unknown"}` +
      ` (posted ${posted ? Object.keys(posted).join(",") || "nothing" : "nothing"}; signature ${signed ? "ok" : "not verified"})`,
  )
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
