"use client";

/**
 * Pricing / subscribe page for MCP access ($300/mo). Logged-in users start a
 * Stripe Checkout session (subscription mode); logged-out users are sent to
 * /login first. Hosted Checkout — we just redirect to the returned URL.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBrowserSupabase } from "@/lib/supabase-browser";

const FEATURES = [
  "Connect your own AI agent (Claude, ChatGPT, Cursor) over MCP",
  "Nine tools: index, movers, issue trends, channel stances, quote-level mention search",
  "Filtered, source-linked verbatim quotes — ask the dataset anything",
  "Daily-fresh data across the full tracked panel",
  "Methodology endpoint for citable, defensible numbers",
];

export default function PricingPage() {
  const supabase = getBrowserSupabase();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
  }, [supabase]);

  const subscribe = async () => {
    setBusy(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "/login?redirect=/pricing"; return; }
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
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
            <Button className="w-full" onClick={subscribe} disabled={busy || authed === null}>
              {busy ? "…" : authed ? "Subscribe" : "Sign in to subscribe"}
            </Button>
            <p className="text-[11px] text-muted-foreground mt-4 text-center">
              Full transcripts are never exposed — verbatim excerpts with source links only. Cancel anytime.
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
