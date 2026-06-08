/**
 * Stripe webhook → keeps the `subscriptions` entitlement row in sync.
 * Verifies the signature against the raw body (App Router: read req.text(),
 * never parsed JSON). Handles the subscription lifecycle events.
 */
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { stripe, syncSubscription } from "@/lib/stripe";

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
        const session = event.data.object;
        if (session.subscription) {
          const sub = await stripe().subscriptions.retrieve(
            typeof session.subscription === "string" ? session.subscription : session.subscription.id,
          );
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
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
