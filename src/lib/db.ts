import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Supabase-js issues every read as a `fetch` GET. Inside the Next.js App
 * Router, `fetch` is monkey-patched to cache by default, which froze our
 * server-side reads at the first snapshot taken after each deploy: the cron
 * (and server components) kept seeing stale data - never their own writes,
 * never the CLI's. (2026-05-24 incident: cron reported pendingFound 1504 on
 * two separate runs while the live table was at 552.) `force-dynamic` on a
 * route does NOT reliably opt the Supabase client's fetches out of the data
 * cache, so we force it at the client level instead.
 *
 * Forcing `cache: "no-store"` on every Supabase request guarantees reads
 * always hit the live database. Harmless in the Node/CLI context (no Next
 * cache there); essential on Vercel.
 */
/**
 * Transient HTTP statuses from Supabase / PostgREST (or its edge) worth a retry.
 * 500 is included on purpose: our reads are cheap and indexed (verified via
 * EXPLAIN), so a 500 on a GET is almost always a transient connection blip, not
 * a query error - and a retry costs ~1s worst case on a genuinely broken GET.
 */
const RETRIABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_BACKOFF_MS = [150, 400];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every Supabase request flows through this one fetch (both clients set it as
 * `global.fetch`), so it's the right choke point for two cross-cutting concerns:
 *
 *  1. `cache: "no-store"` - supabase-js issues reads as `fetch` GETs, which the
 *     Next.js App Router caches by default, freezing server reads at the first
 *     post-deploy snapshot (2026-05-24 incident: cron saw 1504 pending vs 552
 *     live). `force-dynamic` on a route does NOT reliably opt the client's
 *     fetches out, so we force it here.
 *
 *  2. Transient-failure retry for IDEMPOTENT reads only. Intermittent 500s on
 *     the lazy-load read routes (the "Couldn't load this channel's mentions"
 *     panels) traced to transient server->Supabase blips, not query cost; with
 *     no retry anywhere, a single blip stranded the panel until a hard refresh.
 *     We retry GET/HEAD (idempotent) on a network throw or a transient status.
 *     We do NOT retry writes (POST/PATCH/DELETE): the `classifications` insert
 *     is non-idempotent, so retrying a write whose response was merely lost
 *     could double-insert. supabase-js sets method explicitly on writes and
 *     defaults reads to GET, so treating a missing method as GET is correct.
 */
export const noStoreFetch: typeof fetch = async (input, init) => {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxAttempts = idempotent ? RETRY_BACKOFF_MS.length + 1 : 1;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(input, { ...init, cache: "no-store" });
      if (attempt < maxAttempts && RETRIABLE_STATUS.has(res.status)) {
        console.warn(
          `[db] ${method} ${res.status} (attempt ${attempt}/${maxAttempts}) - retrying`,
        );
        await sleep(RETRY_BACKOFF_MS[attempt - 1]);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt >= maxAttempts) break;
      console.warn(
        `[db] ${method} fetch threw (attempt ${attempt}/${maxAttempts}: ${
          (e as Error)?.message || e
        }) - retrying`,
      );
      await sleep(RETRY_BACKOFF_MS[attempt - 1]);
    }
  }
  throw lastErr;
};

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
