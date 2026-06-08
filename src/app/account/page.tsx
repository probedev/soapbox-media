"use client";

/**
 * Minimal account page — subscription status + the post-checkout landing
 * (success_url → /account?checkout=success). Reads /api/stripe/status with the
 * user's session token.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBrowserSupabase } from "@/lib/supabase-browser";

type Status = { email: string; status: string; active: boolean; currentPeriodEnd: string | null; openBeta: boolean };

export default function AccountPage() {
  const supabase = getBrowserSupabase();
  const [status, setStatus] = useState<Status | null>(null);
  const [state, setState] = useState<"loading" | "anon" | "ready">("loading");
  const justSubscribed = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("checkout") === "success";

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setState("anon"); return; }
      const res = await fetch("/api/stripe/status", { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (res.ok) { setStatus(await res.json()); setState("ready"); } else { setState("anon"); }
    })();
  }, [supabase]);

  return (
    <main className="min-h-svh flex items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Your account</CardTitle>
            {status && <CardDescription>{status.email}</CardDescription>}
          </CardHeader>
          <CardContent>
            {state === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
            {state === "anon" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">You&apos;re not signed in.</p>
                <Button className="w-full" onClick={() => (window.location.href = "/login?redirect=/account")}>Sign in</Button>
              </div>
            )}
            {state === "ready" && status && (
              <div className="space-y-4">
                {justSubscribed && status.active && (
                  <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
                    🎉 Subscription active — connect your agent to <code>https://www.soapbox.media/api/mcp/mcp</code>.
                  </p>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">MCP subscription</span>
                  <span className={status.active ? "text-emerald-700 font-medium" : "text-muted-foreground"}>
                    {status.active ? `Active (${status.status})` : status.status}
                  </span>
                </div>
                {status.currentPeriodEnd && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Renews</span>
                    <span>{new Date(status.currentPeriodEnd).toLocaleDateString()}</span>
                  </div>
                )}
                {status.openBeta && !status.active && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    Open beta: MCP access is currently available to all signed-in users.
                  </p>
                )}
                {!status.active && (
                  <Button className="w-full" onClick={() => (window.location.href = "/pricing")}>Subscribe — $300/mo</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
