import { NextResponse } from "next/server"
import { acceptResponse, readResult, recordApprovedPayment, rememberStatus, verifyResult } from "@/lib/wayforpay"

// WayForPay's serviceUrl: called server-to-server with every payment result
// (and retried until it gets a signed "accept").
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const result = await readResult(req).catch(() => null)
  const secret = result && verifyResult(result)
  if (!result?.orderReference || !secret) {
    console.error("[wayforpay] callback with a bad signature:", result?.orderReference ?? "(unreadable)")
    return NextResponse.json({ error: "bad signature" }, { status: 400 })
  }
  console.log(`[wayforpay] ${result.orderReference}: ${result.transactionStatus} ${result.reasonCode ?? ""} ${result.reason ?? ""}`)
  await rememberStatus(result).catch((e) => console.error("[wayforpay] status not saved:", (e as Error).message))
  if (result.transactionStatus === "Approved") {
    try {
      if (!(await recordApprovedPayment(result))) console.error(`[wayforpay] ${result.orderReference}: unknown payment`)
    } catch (e) {
      // No "accept": WayForPay calls again later and the booking is retried.
      console.error(`[wayforpay] ${result.orderReference}: booking failed:`, (e as Error).message)
      return NextResponse.json({ error: "try again" }, { status: 500 })
    }
  }
  return NextResponse.json(acceptResponse(result.orderReference, secret))
}
