/**
 * Stripe integration (workstream 2): $300/mo MCP-access subscription.
 * Server-side only. The Checkout route creates sessions; the webhook route
 * writes the `subscriptions` entitlement row that gates MCP tool access
 * (read via lib/entitlements.ts).
 */
import Stripe from "stripe";

import { createServiceClient } from "@/lib/db";
import { env } from "@/lib/env";

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(env.stripeSecretKey);
  return _stripe;
}

/** The $300/mo recurring price (set STRIPE_PRICE_ID in env). Read at REQUEST
 *  time, not module load — a module-level `process.env` const can be inlined
 *  at build / survive build-cache and miss a later-added runtime var. */
export function priceId(): string {
  return process.env.STRIPE_PRICE_ID || "";
}

/** Find-or-create the Stripe customer for a Supabase user, persisting the id. */
export async function getOrCreateCustomer(userId: string, email: string): Promise<string> {
  const db = createServiceClient();
  const { data } = await db
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id;

  const customer = await stripe().customers.create({ email, metadata: { user_id: userId } });
  await db.from("subscriptions").upsert(
    { user_id: userId, stripe_customer_id: customer.id, status: "inactive", updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return customer.id;
}

/** Upsert entitlement from a Stripe Subscription object (webhook path). */
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const db = createServiceClient();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  // Resolve user_id: prefer customer metadata, fall back to our stored mapping.
  let userId = (sub.metadata?.user_id as string) || "";
  if (!userId) {
    const { data } = await db.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.user_id ?? "";
  }
  if (!userId) {
    console.error(`syncSubscription: no user for customer ${customerId}`);
    return;
  }
  const periodEnd = (sub as any).current_period_end as number | undefined;
  await db.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: sub.items.data[0]?.price?.id ?? null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}
