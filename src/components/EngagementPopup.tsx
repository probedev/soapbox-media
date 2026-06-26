"use client";

/**
 * Site-wide signup popup for the monthly Soapbox Report. Shows only to engaged
 * visitors: at least MIN_PAGES distinct pages seen (cumulative, localStorage)
 * AND at least MIN_SESSION_SEC on the site this session. Shows once, then
 * respects dismissal (DISMISS_DAYS) and subscription. Excludes admin/auth and
 * the gated report pages (which carry their own gate). Posts to
 * /api/report-signup (source "popup").
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const MIN_PAGES = 3;
const MIN_SESSION_SEC = 30;
const DISMISS_DAYS = 30;
const EXCLUDE = [/^\/admin/, /^\/login/, /^\/oauth/, /^\/account/, /^\/eval/, /^\/connect/, /^\/reports\//];
const LS_PATHS = "sb_paths", LS_SUB = "sb_subscribed", LS_DISMISS = "sb_popup_dismissed", SS_START = "sb_session_start";

const excluded = (p: string) => EXCLUDE.some((re) => re.test(p));

export function EngagementPopup() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const eligible = useCallback(() => {
    if (typeof window === "undefined") return false;
    try {
      if (localStorage.getItem(LS_SUB)) return false;
      const dis = Number(localStorage.getItem(LS_DISMISS) || 0);
      if (dis && Date.now() - dis < DISMISS_DAYS * 86_400_000) return false;
      if (excluded(window.location.pathname)) return false;
      const paths: string[] = JSON.parse(localStorage.getItem(LS_PATHS) || "[]");
      if (paths.length < MIN_PAGES) return false;
      const start = Number(sessionStorage.getItem(SS_START) || Date.now());
      return (Date.now() - start) / 1000 >= MIN_SESSION_SEC;
    } catch {
      return false;
    }
  }, []);

  // Track distinct pages + session start.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem(SS_START)) sessionStorage.setItem(SS_START, String(Date.now()));
      if (excluded(pathname)) return;
      const paths: string[] = JSON.parse(localStorage.getItem(LS_PATHS) || "[]");
      if (!paths.includes(pathname)) {
        paths.push(pathname);
        localStorage.setItem(LS_PATHS, JSON.stringify(paths.slice(-50)));
      }
    } catch { /* ignore */ }
  }, [pathname]);

  // Re-check eligibility on navigation and after the dwell window elapses.
  useEffect(() => {
    if (open) return;
    if (eligible()) { setOpen(true); return; }
    const t = setTimeout(() => { if (eligible()) setOpen(true); }, MIN_SESSION_SEC * 1000);
    return () => clearTimeout(t);
  }, [pathname, eligible, open]);

  useEffect(() => {
    if (open) (window as unknown as { posthog?: { capture: (e: string) => void } }).posthog?.capture("report_popup_shown");
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const paths: string[] = JSON.parse(localStorage.getItem(LS_PATHS) || "[]");
      const r = await fetch("/api/report-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "popup", pagesSeen: paths.length }),
      });
      const j = await r.json();
      if (!r.ok) { setStatus("error"); setMsg(j.error || "Something went wrong."); return; }
      try { localStorage.setItem(LS_SUB, "1"); } catch { /* ignore */ }
      (window as unknown as { posthog?: { capture: (e: string, p?: object) => void } }).posthog?.capture("report_signup", { source: "popup" });
      setStatus("done");
    } catch {
      setStatus("error"); setMsg("Network error, please try again.");
    }
  }

  function onOpenChange(o: boolean) {
    if (!o && status !== "done") { try { localStorage.setItem(LS_DISMISS, String(Date.now())); } catch { /* ignore */ } }
    setOpen(o);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {status === "done" ? (
          <div className="text-center py-4">
            <DialogTitle className="text-lg">You&apos;re on the list.</DialogTitle>
            <p className="text-ink-body mt-2 text-sm leading-relaxed">
              The next Soapbox Report will land in your inbox. Thanks for reading.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">The Soapbox Report</p>
              <DialogTitle className="text-xl tracking-tight">Get the monthly data report, free.</DialogTitle>
              <DialogDescription className="text-ink-body leading-relaxed">
                Each month we take a claim everyone is arguing about and settle it with the tape, like our
                breakdown of whether CBS News tilted toward Trump under Bari Weiss. Scores, receipts, and
                direct links. Be first to read the next one.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="mt-2 flex flex-col gap-2">
              <Input
                type="email" required placeholder="you@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} disabled={status === "loading"} aria-label="Email address"
              />
              <Button type="submit" disabled={status === "loading"}>
                {status === "loading" ? "Joining..." : "Send me the report"}
              </Button>
              {status === "error" && <p className="text-xs text-red-600">{msg}</p>}
              <p className="text-[11px] text-ink-faint text-center">No spam. One report a month. Unsubscribe anytime.</p>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
