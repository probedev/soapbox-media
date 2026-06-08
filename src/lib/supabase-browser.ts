/**
 * Browser-side Supabase client (anon key, session persisted in the browser).
 * Used ONLY by end-user-facing auth surfaces — currently the OAuth consent
 * page (/oauth/consent), which needs a logged-in user session to call
 * supabase.auth.oauth.{getAuthorizationDetails,approveAuthorization,...}.
 *
 * Distinct from src/lib/db.ts, which is server-side (service-role / anon, no
 * session) for data access. Keep them separate: this one carries a user
 * identity; that one never should.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
