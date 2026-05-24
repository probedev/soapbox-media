import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Supabase-js issues every read as a `fetch` GET. Inside the Next.js App
 * Router, `fetch` is monkey-patched to cache by default, which froze our
 * server-side reads at the first snapshot taken after each deploy: the cron
 * (and server components) kept seeing stale data — never their own writes,
 * never the CLI's. (2026-05-24 incident: cron reported pendingFound 1504 on
 * two separate runs while the live table was at 552.) `force-dynamic` on a
 * route does NOT reliably opt the Supabase client's fetches out of the data
 * cache, so we force it at the client level instead.
 *
 * Forcing `cache: "no-store"` on every Supabase request guarantees reads
 * always hit the live database. Harmless in the Node/CLI context (no Next
 * cache there); essential on Vercel.
 */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/**
 * Server-side Supabase client with full service-role privileges.
 * NEVER use in browser code. Used by scripts and server components only.
 */
export function createServiceClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}

/**
 * Anon-key Supabase client. Safe to use anywhere. Bound by RLS policies.
 */
export function createAnonClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}
