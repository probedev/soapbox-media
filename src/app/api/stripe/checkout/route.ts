/**
 * Pay-first Checkout: no account required. Creates a Stripe Checkout session
 * (subscription mode) that collects the email and creates the customer; the
 * webhook then provisions the Supabase user from that email. Returns the
 * hosted Checkout URL to redirect to.
 */
import { type NextRequest, NextResponse } from "next/server";

import { stripe, priceId } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.soapbox.media";

export async function POST(req: NextRequest) {
  const PRICE = priceId();
  if (!PRICE) return NextResponse.json({ error: "STRIPE_PRICE_ID not configured" }, { status: 500 });

  const origin = req.headers.get("origin") || SITE_URL;
  // Optional: prefill the email if the caller passes one (e.g. a logged-in user).
  let email: string | undefined;
  try { email = (await req.json())?.email; } catch { /* no body */ }

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription", // subscription mode always creates a customer + collects email
      line_items: [{ price: PRICE, quantity: 1 }],
      ...(email ? { customer_email: email } : {}),
      success_url: `${origin}/welcome?paid=1`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error(`CHECKOUT_ERR keyMode=${(process.env.STRIPE_SECRET_KEY ?? "").slice(0, 8)} price=${PRICE} msg=${e?.message}`);
    return NextResponse.json({ error: e?.message ?? "stripe error" }, { status: 502 });
  }
}
