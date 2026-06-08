"use client";

/**
 * Functional Soapbox login (shadcn login-03 block, wired to Supabase Auth).
 * Email/password sign-in + sign-up, plus Google/Apple social OAuth. Used by
 * the OAuth consent screen (/oauth/consent) and the standalone /login page.
 *
 * `redirectTo` is where social OAuth returns the user after the provider round
 * trip — pass the current consent URL so the authorization flow continues.
 * Password auth resolves in place; the parent reacts via onAuthStateChange.
 */
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserSupabase } from "@/lib/supabase-browser";

interface LoginFormProps extends React.ComponentPropsWithoutRef<"div"> {
  redirectTo?: string;
  heading?: string;
  description?: string;
}

export function LoginForm({
  className,
  redirectTo,
  heading = "Welcome to Soapbox",
  description = "Sign in to authorize access",
  ...props
}: LoginFormProps) {
  const supabase = getBrowserSupabase();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const oauth = async (provider: "google" | "apple") => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectTo ?? (typeof window !== "undefined" ? window.location.href : undefined) },
    });
    if (error) setError(error.message);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    if (mode === "signup") setNotice("Account created. If email confirmation is enabled, confirm then sign in.");
    else if (redirectTo) window.location.href = redirectTo;
  };

  const resetPassword = async () => {
    if (!email) { setError("Enter your email first, then tap reset."); return; }
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setNotice(error ? null : "Password reset email sent.");
    if (error) setError(error.message);
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{heading}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <div className="grid gap-6">
              <div className="flex flex-col gap-4">
                <Button type="button" variant="outline" className="w-full" onClick={() => oauth("apple")}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4">
                    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" fill="currentColor" />
                  </svg>
                  Continue with Apple
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => oauth("google")}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4">
                    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" fill="currentColor" />
                  </svg>
                  Continue with Google
                </Button>
              </div>
              <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
                <span className="relative z-10 bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
              <div className="grid gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="m@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center">
                    <Label htmlFor="password">Password</Label>
                    <button type="button" onClick={resetPassword} className="ml-auto text-sm underline-offset-4 hover:underline">
                      Forgot your password?
                    </button>
                  </div>
                  <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                {notice && <p className="text-sm text-emerald-700">{notice}</p>}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
                </Button>
              </div>
              <div className="text-center text-sm">
                {mode === "signin" ? "Don't have an account? " : "Have an account? "}
                <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setNotice(null); }} className="underline underline-offset-4">
                  {mode === "signin" ? "Sign up" : "Sign in"}
                </button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-primary">
        By continuing, you agree to our <a href="/methodology">terms</a>.
      </div>
    </div>
  );
}
