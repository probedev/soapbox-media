"use client";

/**
 * Pay-first subscribe trigger. Starts a Stripe Checkout session (no login
 * required) and redirects to the hosted page. If the visitor is logged in,
 * prefills their email so the resulting account links to their existing one.
 */
import { useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase-browser";

export function SubscribeButton({ className = "", label = "Subscribe — $300/mo" }: { className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true); setError(null);
    let email: string | undefined;
    try {
      const { data } = await getBrowserSupabase().auth.getSession();
      email = data.session?.user?.email;
    } catch { /* anonymous is fine */ }
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (json.url) window.location.href = json.url;
    else setError(json.error || "Could not start checkout.");
  };

  return (
    <div className={className}>
      <button
        onClick={go}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-md bg-gray-900 text-white text-sm font-medium px-5 py-2.5 hover:bg-gray-800 disabled:opacity-50 transition"
      >
        {busy ? "…" : label}
      </button>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
