/**
 * Stripe integration (workstream 2): $300/mo MCP-access subscription,
 * PAY-FIRST model. Anyone can check out without an account; Stripe collects
 * the email; the webhook provisions a Supabase user from that email (sending a
 * set-password invite), links the subscription, and grants entitlement.
 * Server-side only. Entitlement gates MCP access via lib/entitlements.ts.
 */
import Stripe from "stripe";

import { createServiceClient } from "@/lib/db";
import { env } from "@/lib/env";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.soapbox.media";

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(env.stripeSecretKey);
  return _stripe;
}

/** The $300/mo recurring price (set STRIPE_PRICE_ID in env). Read at REQUEST
 *  time, not module load - a module-level const can be build-inlined / survive
 *  build-cache and miss a later-added runtime var. */
export function priceId(): string {
  return process.env.STRIPE_PRICE_ID || "";
}

/**
 * Pay-first provisioning: return the Supabase user id for this email, creating
 * the user (and emailing a set-password invite that lands on /welcome) if they
 * don't exist yet. Idempotent - an existing account is reused, not duplicated.
 */
export async function provisionUserByEmail(email: string): Promise<string> {
  const admin = createServiceClient();
  const lower = email.trim().toLowerCase();
  // Existing user? (panel is small; listUsers is fine for now - revisit with a
  // direct lookup if the user base grows past a page.)
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === lower);
  if (existing) return existing.id;
  // New user → create + send invite (set-password) email landing on /welcome.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/welcome`,
  });
  if (error || !data?.user) throw new Error(`provisionUserByEmail: ${error?.message}`);
  return data.user.id;
}

/** Upsert the entitlement row for a user from a Stripe subscription object. */
export async function linkSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const db = createServiceClient();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const periodEnd = (sub as { current_period_end?: number }).current_period_end;
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

/**
 * For subscription.updated/deleted events (no email on the object): resolve the
 * user via the stored customer→user mapping written at checkout completion.
 */
export async function syncSubscriptionByCustomer(sub: Stripe.Subscription): Promise<void> {
  const db = createServiceClient();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!data?.user_id) {
    // Likely an event that arrived before checkout.session.completed created the
    // row - harmless; completion will link it.
    console.warn(`syncSubscriptionByCustomer: no user yet for ${customerId}`);
    return;
  }
  await linkSubscription(data.user_id, sub);
}
