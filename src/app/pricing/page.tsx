"use client";

/**
 * Pricing / subscribe page for MCP access ($300/mo). Logged-in users start a
 * Stripe Checkout session (subscription mode); logged-out users are sent to
 * /login first. Hosted Checkout - we just redirect to the returned URL.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBrowserSupabase } from "@/lib/supabase-browser";

const FEATURES = [
  "Connect your own AI agent (Claude, ChatGPT, Cursor) over MCP",
  "Nine tools: index, movers, issue trends, channel stances, quote-level mention search",
  "Filtered, source-linked verbatim quotes - ask the dataset anything",
  "Daily-fresh data across the full tracked panel",
  "Methodology endpoint for citable, defensible numbers",
];

export default function PricingPage() {
  const supabase = getBrowserSupabase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pay-first: no account required to subscribe. Stripe collects the email and
  // the webhook provisions the account afterward. If the visitor happens to be
  // logged in, we prefill their email so it links to their existing account.
  const subscribe = async () => {
    setBusy(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: session?.user?.email }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (json.url) window.location.href = json.url;
    else setError(json.error || "Could not start checkout.");
  };

  return (
    <main className="min-h-svh flex items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">
              Soapbox <span className="text-[#114A8A]">MCP Access</span>
            </CardTitle>
            <CardDescription>Your AI agent, plugged into the dataset</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center mb-6">
              <span className="text-4xl font-semibold">$300</span>
              <span className="text-muted-foreground">/month</span>
            </div>
            <ul className="space-y-2 mb-6">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="text-emerald-600 mt-0.5">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <Button className="w-full" onClick={subscribe} disabled={busy}>
              {busy ? "…" : "Subscribe"}
            </Button>
            <p className="text-[11px] text-muted-foreground mt-4 text-center">
              Pay, then we email you a link to set your password and connect your agent. Full transcripts are never exposed - excerpts + source links only. Cancel anytime.
            </p>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground mt-4">
          Just exploring? See the <a href="/mcp" className="underline">MCP overview</a>.
        </p>
      </div>
    </main>
  );
}
