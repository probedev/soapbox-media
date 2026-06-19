import { LoginForm } from "@/components/login-form";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

/**
 * Standalone account login. Used for account/subscription management
 * (workstream 2). The OAuth consent screen (/oauth/consent) renders the same
 * LoginForm inline. On password sign-in this redirects home; wire to /account
 * once that surface exists.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="flex items-center gap-2 self-center">
          <Wordmark className="text-2xl" />
        </a>
        <LoginForm redirectTo="/" heading="Welcome back" description="Sign in to your Soapbox account" />
      </div>
    </div>
  );
}
