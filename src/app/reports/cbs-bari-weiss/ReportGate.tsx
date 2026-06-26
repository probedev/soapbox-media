"use client";

import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Email gate for the full report. On signup the API sets the `sb_unlocked`
 *  cookie; we reload so the server renders the full report. */
export function ReportGate({ reportSlug }: { reportSlug: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const r = await fetch("/api/report-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "report-gate", reportSlug }),
      });
      const j = await r.json();
      if (!r.ok) { setStatus("error"); setMsg(j.error || "Something went wrong."); return; }
      try { localStorage.setItem("sb_subscribed", "1"); } catch { /* ignore */ }
      (window as unknown as { posthog?: { capture: (e: string, p?: object) => void } }).posthog?.capture(
        "report_signup", { source: "report-gate", report: reportSlug },
      );
      window.location.reload();
    } catch {
      setStatus("error"); setMsg("Network error, please try again.");
    }
  }

  return (
    <div className="relative mt-2">
      <div className="h-20 -mt-20 bg-gradient-to-b from-transparent to-background pointer-events-none" aria-hidden />
      <div className="rounded-lg border border-border bg-subtle p-6 sm:p-8 text-center">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-card border border-border mb-3">
          <Lock className="w-4 h-4 text-ink-muted" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Read the full report, free.</h2>
        <p className="text-ink-body mt-2 leading-relaxed max-w-md mx-auto">
          The rest is free: the story-by-story breakdown, the Venezuela deep-dive, the 136 sourced receipts
          with timestamped video links, and the timeline. Drop your email to keep reading, and to get the
          monthly Soapbox Report.
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
          <Input
            type="email" required placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} disabled={status === "loading"} aria-label="Email address"
          />
          <Button type="submit" disabled={status === "loading"} className="shrink-0">
            {status === "loading" ? "Unlocking..." : "Read the full report"}
          </Button>
        </form>
        {status === "error" && <p className="text-xs text-red-600 mt-2">{msg}</p>}
        <p className="text-[11px] text-ink-faint mt-3">No spam. One report a month. Unsubscribe anytime.</p>
      </div>
    </div>
  );
}
