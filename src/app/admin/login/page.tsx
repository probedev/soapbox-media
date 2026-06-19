import { login } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-subtle px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <Wordmark className="text-2xl" />
          <div className="text-xs uppercase tracking-wider text-ink-faint mt-1">Admin</div>
        </div>
        <form
          action={login}
          className="border border-border rounded-lg bg-card p-6 space-y-3 shadow-sm"
        >
          <Label className="block text-sm text-ink-muted font-normal leading-normal">
            Password
            <Input
              type="password"
              name="password"
              autoFocus
              autoComplete="current-password"
              className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm h-auto"
            />
          </Label>
          {searchParams.error && (
            <p className="text-xs text-red-600">Incorrect password. Try again.</p>
          )}
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
