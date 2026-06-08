/**
 * One-off (idempotent): create the Soapbox MCP Access product + $300/mo
 * recurring price in Stripe, in whatever mode the STRIPE_SECRET_KEY belongs to
 * (test key → test objects). Prints the price id to add as STRIPE_PRICE_ID.
 * Re-runs reuse the existing product/price rather than duplicating.
 *
 * Run: npx tsx scripts/setup-stripe-product.ts
 */
import "./_load-env";

import { stripe } from "@/lib/stripe";

const PRODUCT_NAME = "Soapbox MCP Access";
const AMOUNT = 30000; // $300.00
const CURRENCY = "usd";

async function main() {
  const s = stripe();
  // reuse existing product by exact name
  const products = await s.products.list({ limit: 100, active: true });
  let product = products.data.find((p) => p.name === PRODUCT_NAME) ?? null;
  if (!product) {
    product = await s.products.create({
      name: PRODUCT_NAME,
      description: "Full access to the Soapbox MCP server — query the political-media dataset (index, trends, channel stances, mention quotes) via your own AI agent.",
    });
    console.log(`created product ${product.id}`);
  } else {
    console.log(`reusing product ${product.id}`);
  }

  // reuse existing matching recurring price
  const prices = await s.prices.list({ product: product.id, active: true, limit: 100 });
  let price = prices.data.find(
    (p) => p.unit_amount === AMOUNT && p.currency === CURRENCY && p.recurring?.interval === "month",
  ) ?? null;
  if (!price) {
    price = await s.prices.create({
      product: product.id,
      unit_amount: AMOUNT,
      currency: CURRENCY,
      recurring: { interval: "month" },
    });
    console.log(`created price ${price.id}`);
  } else {
    console.log(`reusing price ${price.id}`);
  }

  const mode = (process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_") ? "TEST" : "LIVE";
  console.log(`\n[${mode} mode] Add this to .env.local:\nSTRIPE_PRICE_ID=${price.id}`);
}

main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });
