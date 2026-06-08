"use client";

/**
 * OAuth 2.1 consent screen (Part B of MCP auth). Supabase's OAuth server
 * redirects the user here (Authorization Path = /oauth/consent in the
 * dashboard, combined with Site URL) with an `authorization_id`. We:
 *   1. require a logged-in Supabase user session (shadcn login-03 form);
 *   2. fetch the request details (which client, which scopes);
 *   3. let the user Approve/Deny, then redirect back to the client.
 *
 * API: supabase.auth.oauth.getAuthorizationDetails / approveAuthorization /
 * denyAuthorization. getAuthorizationDetails returns either consent details
 * or (if already consented) an immediate redirect.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/login-form";
import { getBrowserSupabase } from "@/lib/supabase-browser";

type Details = {
  authorization_id: string;
  client: { name: string; uri?: string; logo_uri?: string };
  scope: string;
  user: { email: string };
};

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm your identity",
  email: "Your email address",
  profile: "Your basic profile",
  mcp: "Query Soapbox data on your behalf",
};

export default function ConsentPage() {
  const supabase = getBrowserSupabase();
  const [authId, setAuthId] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState<string | undefined>(undefined);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "submitting" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRedirectTo(window.location.href);
    const id = new URLSearchParams(window.location.search).get("authorization_id");
    setAuthId(id);
    if (!id) { setStatus("error"); setError("Missing authorization_id — open this page from your AI client's connect flow."); }
  }, []);

  const loadDetails = useCallback(async (id: string) => {
    setStatus("loading");
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (error) { setStatus("error"); setError(error.message); return; }
    if (data && "redirect_url" in data) { window.location.href = (data as any).redirect_url; return; } // already consented
    setDetails(data as unknown as Details);
    setStatus("ready");
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (authed && authId) loadDetails(authId);
  }, [authed, authId, loadDetails]);

  const decide = async (approve: boolean) => {
    if (!authId) return;
    setStatus("submitting");
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error } = await fn(authId, { skipBrowserRedirect: true });
    if (error) { setStatus("error"); setError(error.message); return; }
    const url = (data as any)?.redirect_url;
    if (url) window.location.href = url;
    else { setStatus("error"); setError("No redirect URL returned."); }
  };

  return (
    <main className="min-h-svh flex items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        {status === "error" && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {status !== "error" && authed === false && (
          <LoginForm redirectTo={redirectTo} description="Sign in to authorize MCP access" />
        )}

        {status === "loading" && authed && (
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Loading request…</p></CardContent></Card>
        )}

        {authed && details && (status === "ready" || status === "submitting") && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">
                Authorize <span className="text-[#114A8A]">{details.client.name}</span>
              </CardTitle>
              <CardDescription>wants to access your Soapbox account · {details.user.email}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 mb-6">
                {details.scope.split(" ").filter(Boolean).map((s) => (
                  <li key={s} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="text-emerald-600 mt-0.5">✓</span>
                    <span>{SCOPE_LABELS[s] ?? s}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={() => decide(true)} disabled={status === "submitting"}>
                  {status === "submitting" ? "…" : "Approve"}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => decide(false)} disabled={status === "submitting"}>
                  Deny
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-4">
                This app will query Soapbox data (issue trends, channel stances, mention quotes) as you. It never receives full transcripts. Revoke anytime.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
