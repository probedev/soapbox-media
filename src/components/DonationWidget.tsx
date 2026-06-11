"use client";

/**
 * Pay-what-you-want support widget: preset amounts + custom, one-time or
 * monthly, → Stripe Checkout via /api/stripe/donate. No login required.
 * Conversion-tuned (ActBlue-style): tiered amount grid with a "popular" anchor,
 * a monthly nudge, a prominent CTA, and a trust line.
 */
import { useState } from "react";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PRESETS = [10, 25, 50, 100, 250, 500];
// Default + anchored "popular" amount. The single biggest conversion lever on
// this page - worth A/B testing for a reader audience (lower) vs donor (higher).
const POPULAR = 50;

export function DonationWidget({ lean = "" }: { lean?: string }) {
  const [amount, setAmount] = useState<number>(POPULAR);
  const [custom, setCustom] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dollars = custom ? Math.round(parseFloat(custom) * 100) / 100 : amount;

  const donate = async () => {
    setBusy(true);
    setError(null);
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
      <div className="text-base font-semibold text-ink-strong mb-3">Chip in to keep it independent</div>

      {/* frequency */}
      <div className="flex rounded-md border border-border p-0.5 text-sm">
        {([["One-time", false], ["Monthly", true]] as const).map(([label, val]) => (
          <Button
            key={label}
            variant="ghost"
            onClick={() => setRecurring(val)}
            className={`flex-1 h-auto rounded py-1.5 text-sm font-medium transition ${recurring === val ? "bg-primary text-white hover:bg-primary hover:text-white" : "text-ink-muted hover:text-foreground"}`}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-ink-faint mt-1.5 mb-3">
        {recurring
          ? "Monthly support funds us all year. Cancel anytime."
          : "Or switch to monthly to fund us all year."}
      </p>

      {/* presets */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {PRESETS.map((p) => {
          const active = !custom && amount === p;
          return (
            <Button
              key={p}
              variant="outline"
              onClick={() => {
                setAmount(p);
                setCustom("");
              }}
              className={`relative h-auto rounded-md border py-2.5 text-sm font-semibold tabular-nums transition ${active ? "border-foreground bg-primary text-white hover:bg-primary hover:text-white" : "border-input text-ink-body hover:border-ink-faint hover:bg-background hover:text-ink-body"}`}
            >
              ${p}
              {p === POPULAR && (
                <span
                  className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-semibold uppercase tracking-wider px-1.5 py-px rounded-full leading-none ${active ? "bg-white text-primary" : "bg-primary text-white"}`}
                >
                  Popular
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {/* custom */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
        <Input
          type="number"
          min={1}
          step={1}
          placeholder="Other amount"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-auto w-full border border-input rounded-md pl-7 pr-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <Button
        onClick={donate}
        disabled={busy || !dollars || dollars < 1}
        className="h-auto w-full rounded-md bg-primary text-white py-3 text-base font-semibold hover:bg-primary/90 disabled:opacity-50 transition"
      >
        {busy ? "…" : `Contribute $${dollars || 0}${recurring ? "/mo" : ""}`}
      </Button>

      <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-faint mt-3">
        <Lock className="w-3 h-3 shrink-0" />
        Secure checkout via Stripe · no account needed
      </div>
    </Card>
  );
}
