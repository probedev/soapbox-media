"use client";

/**
 * Pay-what-you-want support widget: preset amounts + custom, one-time or
 * monthly, → Stripe Checkout via /api/stripe/donate. No login required.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PRESETS = [10, 25, 50, 100];

export function DonationWidget({ lean = "" }: { lean?: string }) {
  const [amount, setAmount] = useState<number>(25);
  const [custom, setCustom] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dollars = custom ? Math.round(parseFloat(custom) * 100) / 100 : amount;

  const donate = async () => {
    setBusy(true); setError(null);
    const amountCents = Math.round((custom ? parseFloat(custom) : amount) * 100);
    const res = await fetch("/api/stripe/donate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents, recurring, lean }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (json.url) window.location.href = json.url;
    else setError(json.error || "Couldn't start checkout.");
  };

  return (
    <Card className="p-5">
      {/* frequency */}
      <div className="flex rounded-md border border-border p-0.5 mb-4 text-sm">
        {[["one-time", false], ["monthly", true]].map(([label, val]) => (
          <Button
            key={label as string}
            variant="ghost"
            onClick={() => setRecurring(val as boolean)}
            className={`flex-1 h-auto rounded py-1.5 text-sm font-medium transition ${recurring === val ? "bg-primary text-white hover:bg-primary hover:text-white" : "text-ink-muted hover:text-foreground"}`}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* presets */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {PRESETS.map((p) => (
          <Button
            key={p}
            variant="outline"
            onClick={() => { setAmount(p); setCustom(""); }}
            className={`h-auto rounded-md border py-2 text-sm font-medium transition ${!custom && amount === p ? "border-foreground bg-primary text-white hover:bg-primary hover:text-white" : "border-input text-ink-body hover:border-ink-faint hover:bg-background hover:text-ink-body"}`}
          >
            ${p}
          </Button>
        ))}
      </div>

      {/* custom */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
        <Input
          type="number" min={1} step={1} placeholder="Other amount"
          value={custom} onChange={(e) => setCustom(e.target.value)}
          className="h-auto w-full border border-input rounded-md pl-7 pr-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <Button
        onClick={donate}
        disabled={busy || !dollars || dollars < 1}
        className="h-auto w-full rounded-md bg-primary text-white py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition"
      >
        {busy ? "…" : `Contribute $${dollars || 0}${recurring ? "/mo" : ""}`}
      </Button>
      <p className="text-[11px] text-ink-faint mt-3 text-center">
        Supports Soapbox.media&apos;s operations. Not a political contribution and not tax-deductible.
      </p>
    </Card>
  );
}
