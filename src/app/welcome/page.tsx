"use client";

/**
 * Pay-first onboarding landing. Two entry points:
 *  1. Right after Stripe payment (success_url = /welcome?paid=1) - the invite
 *     email is on its way; tell them to check it.
 *  2. From the Supabase invite/set-password email link - a session is
 *     established (detectSessionInUrl), so we show a set-password form, then
 *     the "connect your agent" instructions.
 */
import { useEffect, useState } from "react";

import { CopyField } from "@/components/CopyField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/Wordmark";
import { getBrowserSupabase } from "@/lib/supabase-browser";

const ENDPOINT = "https://www.soapbox.media/api/mcp/mcp";

export default function WelcomePage() {
  const supabase = getBrowserSupabase();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const setPw = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else setDone(true);
  };

  return (
    <main className="min-h-svh flex items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              Welcome to <Wordmark />
            </CardTitle>
            <CardDescription>
              {done ? "You're all set" : authed ? "Set a password to finish" : "Payment received"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Paid, but no session yet → invite email is in flight */}
            {authed === false && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>🎉 Thanks for subscribing! We&apos;ve emailed you a link to <strong>set your password</strong> and activate access.</p>
                <p>Check your inbox (and spam) and click the link to finish - it brings you right back here.</p>
              </div>
            )}

            {/* Came in via the invite link → set password */}
            {authed && !done && (
              <form onSubmit={setPw} className="space-y-4">
                <p className="text-sm text-muted-foreground">Choose a password for your Soapbox account.</p>
                <div className="grid gap-2">
                  <Label htmlFor="pw">Password</Label>
                  <Input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "…" : "Set password & continue"}</Button>
              </form>
            )}

            {/* Done → connect instructions */}
            {done && (
              <div className="space-y-3 text-sm">
                <p className="text-emerald-700">Account ready - your subscription is active. 🎉</p>
                <p className="text-muted-foreground">
                  One step left: add Soapbox to your AI app. Paste this address as a custom MCP
                  connector, then sign in with this email and password when prompted:
                </p>
                <CopyField value={ENDPOINT} label="MCP server URL" />
                <Button className="w-full" onClick={() => (window.location.href = "/connect")}>
                  Connect your agent: step by step
                </Button>
                <Button
                  variant="link"
                  className="w-full h-auto p-0 text-xs text-muted-foreground underline"
                  onClick={() => (window.location.href = "/account")}
                >
                  Go to your account
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
