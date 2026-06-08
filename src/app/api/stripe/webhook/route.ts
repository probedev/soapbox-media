/**
 * Stripe webhook → keeps the `subscriptions` entitlement row in sync.
 * Verifies the signature against the raw body (App Router: read req.text(),
 * never parsed JSON). Handles the subscription lifecycle events.
 */
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { stripe, provisionUserByEmail, linkSubscription, syncSubscriptionByCustomer } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const body = await req.text(); // raw body required for signature verification
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, env.stripeWebhookSecret);
  } catch (e: any) {
    return NextResponse.json({ error: `signature verification failed: ${e.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // Pay-first provisioning: create/find the Supabase user from the
        // checkout email, then link the subscription + grant entitlement.
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email;
        if (session.subscription && email) {
          const userId = await provisionUserByEmail(email);
          const sub = await stripe().subscriptions.retrieve(
            typeof session.subscription === "string" ? session.subscription : session.subscription.id,
          );
          await linkSubscription(userId, sub);
        } else {
          console.error(`checkout.session.completed missing ${!email ? "email" : "subscription"}`);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        // Resolve the user via the customer mapping written at completion.
        await syncSubscriptionByCustomer(event.data.object);
        break;
      default:
        break; // ignore other events
    }
  } catch (e: any) {
    console.error(`stripe webhook ${event.type} handler failed:`, e?.message);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
