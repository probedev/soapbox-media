import { login } from "./actions";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="font-black text-2xl tracking-tight">
            <span className="text-[#C8202F]">soap</span>
            <span className="text-[#114A8A]">box</span>
          </div>
          <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Admin</div>
        </div>
        <form
          action={login}
          className="border border-gray-200 rounded-lg bg-white p-6 space-y-3 shadow-sm"
        >
          <label className="block text-sm text-gray-600">
            Password
            <input
              type="password"
              name="password"
              autoFocus
              autoComplete="current-password"
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </label>
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
