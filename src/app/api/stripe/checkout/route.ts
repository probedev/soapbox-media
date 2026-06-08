/**
 * Creates a Stripe Checkout session (subscription mode) for the logged-in
 * Supabase user. Called from /pricing with the user's access token in the
 * Authorization header. Returns the hosted Checkout URL to redirect to.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { stripe, priceId, getOrCreateCustomer } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const PRICE = priceId();
  if (!PRICE) return NextResponse.json({ error: "STRIPE_PRICE_ID not configured" }, { status: 500 });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Validate the Supabase session token → user.
  const supa = createClient(env.supabaseUrl, env.supabaseAnonKey);
  const { data: { user }, error } = await supa.auth.getUser(token);
  if (error || !user?.email) return NextResponse.json({ error: "invalid session" }, { status: 401 });

  const origin = req.headers.get("origin") || "https://www.soapbox.media";
  const customerId = await getOrCreateCustomer(user.id, user.email);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: PRICE, quantity: 1 }],
    client_reference_id: user.id,
    subscription_data: { metadata: { user_id: user.id } },
    success_url: `${origin}/account?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
