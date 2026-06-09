"use client";

/**
 * Pay-what-you-want support widget: preset amounts + custom, one-time or
 * monthly, → Stripe Checkout via /api/stripe/donate. No login required.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
    <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm">
      {/* frequency */}
      <div className="flex rounded-md border border-gray-200 p-0.5 mb-4 text-sm">
        {[["one-time", false], ["monthly", true]].map(([label, val]) => (
          <Button
            key={label as string}
            variant="ghost"
            onClick={() => setRecurring(val as boolean)}
            className={`flex-1 h-auto rounded py-1.5 text-sm font-medium transition ${recurring === val ? "bg-gray-900 text-white hover:bg-gray-900 hover:text-white" : "text-gray-600 hover:text-gray-900"}`}
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
            className={`h-auto rounded-md border py-2 text-sm font-medium transition ${!custom && amount === p ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-900 hover:text-white" : "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-background hover:text-gray-700"}`}
          >
            ${p}
          </Button>
        ))}
      </div>

      {/* custom */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
        <Input
          type="number" min={1} step={1} placeholder="Other amount"
          value={custom} onChange={(e) => setCustom(e.target.value)}
          className="h-auto w-full border border-gray-300 rounded-md pl-7 pr-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <Button
        onClick={donate}
        disabled={busy || !dollars || dollars < 1}
        className="h-auto w-full rounded-md bg-gray-900 text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition"
      >
        {busy ? "…" : `Contribute $${dollars || 0}${recurring ? "/mo" : ""}`}
      </Button>
      <p className="text-[11px] text-gray-400 mt-3 text-center">
        Supports Soapbox.media&apos;s operations. Not a political contribution and not tax-deductible.
      </p>
    </div>
  );
}
