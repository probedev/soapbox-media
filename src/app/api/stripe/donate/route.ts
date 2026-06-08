/**
 * Support donations to Soapbox (Breakfastball LLC) - NOT to candidates, not
 * tax-deductible. One-time (payment mode, pay-what-you-want) or monthly
 * (subscription mode, ad-hoc recurring price). No account/entitlement: it's a
 * contribution, so we just take the payment and say thanks.
 */
import { type NextRequest, NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.soapbox.media";
const MIN_CENTS = 100; // $1
const MAX_CENTS = 1_000_000; // $10,000

export async function POST(req: NextRequest) {
  let body: { amountCents?: number; recurring?: boolean; lean?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }

  const amt = Math.round(Number(body.amountCents));
  if (!Number.isFinite(amt) || amt < MIN_CENTS || amt > MAX_CENTS) {
    return NextResponse.json({ error: "Enter an amount between $1 and $10,000." }, { status: 400 });
  }
  const recurring = !!body.recurring;
  const origin = req.headers.get("origin") || SITE_URL;

  try {
    const session = await stripe().checkout.sessions.create({
      mode: recurring ? "subscription" : "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: recurring ? "Monthly support - Soapbox.media" : "Support - Soapbox.media" },
          unit_amount: amt,
          ...(recurring ? { recurring: { interval: "month" as const } } : {}),
        },
        quantity: 1,
      }],
      // "donate" submit button is payment-mode only.
      ...(recurring ? {} : { submit_type: "donate" as const }),
      metadata: { kind: "support", lean: body.lean ?? "" },
      success_url: `${origin}/support/thanks`,
      cancel_url: `${origin}/support`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error(`DONATE_ERR msg=${e?.message}`);
    return NextResponse.json({ error: e?.message ?? "stripe error" }, { status: 502 });
  }
}
