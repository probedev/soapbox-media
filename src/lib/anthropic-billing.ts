/**
 * Reconcile our self-reported token-cost ESTIMATES (usage_log) against
 * Anthropic's ACTUAL billed cost, via the Admin Usage & Cost API. Catches drift
 * from rate changes, cache accounting, batch discounts, or untracked LLM calls.
 *
 * Server-only. Requires an Admin API key (`sk-ant-admin...`, org-admin scoped,
 * provisioned in Console -> Admin keys) in `ANTHROPIC_ADMIN_KEY`. Returns null
 * gracefully when the key is absent so /admin/costs still renders.
 *
 * Cost API: GET /v1/organizations/cost_report. `amount` is a decimal string in
 * USD CENTS (lowest units) - divide by 100. Daily buckets only. Data lands
 * within ~5 min. Priority-tier spend is excluded by Anthropic.
 * Docs: platform.claude.com/docs/en/build-with-claude/usage-cost-api
 */
const COST_URL = "https://api.anthropic.com/v1/organizations/cost_report";

export interface ActualCost {
  /** Total actual billed USD over the window. */
  totalUsd: number;
  /** Per-day actual USD keyed by YYYY-MM-DD (bucket start). */
  byDay: Record<string, number>;
  startedAt: string;
  endedAt: string;
}

/** Whether the Admin key is configured (drives the "configure" hint on /admin/costs). */
export function isBillingReconcileConfigured(): boolean {
  return !!process.env.ANTHROPIC_ADMIN_KEY;
}

/**
 * Actual billed cost for the trailing `days` (default 30), daily-bucketed.
 * Null when unconfigured or on any API error (logged, never throws) so the
 * dashboard degrades to estimate-only.
 */
export async function getActualCost(days = 30): Promise<ActualCost | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return null;

  const now = new Date();
  const start = new Date(now.getTime() - days * 86_400_000);
  const startingAt = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
  // ending_at is exclusive; push to tomorrow's 00:00 so today's bucket is included.
  const end = new Date(now.getTime() + 86_400_000);
  const endingAt = `${end.toISOString().slice(0, 10)}T00:00:00Z`;

  const byDay: Record<string, number> = {};
  let total = 0;
  let page: string | undefined;

  try {
    // Bounded loop: 31 daily buckets fit in one page (limit max 31), but follow
    // pagination defensively in case grouping splits results across pages.
    for (let i = 0; i < 12; i++) {
      const url = new URL(COST_URL);
      url.searchParams.set("starting_at", startingAt);
      url.searchParams.set("ending_at", endingAt);
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);

      const res = await fetch(url.toString(), {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        // Next caches fetch by default; force a live read (see CLAUDE.md / db.ts).
        cache: "no-store",
      });
      if (!res.ok) {
        console.error(`getActualCost: ${res.status} ${(await res.text()).slice(0, 300)}`);
        return null;
      }
      const json = (await res.json()) as {
        data?: { starting_at?: string; results?: { amount?: string }[] }[];
        has_more?: boolean;
        next_page?: string;
      };

      for (const bucket of json.data ?? []) {
        const day = String(bucket.starting_at ?? "").slice(0, 10);
        for (const r of bucket.results ?? []) {
          const cents = parseFloat(r.amount ?? "0");
          if (!Number.isFinite(cents)) continue;
          const usd = cents / 100;
          total += usd;
          if (day) byDay[day] = (byDay[day] ?? 0) + usd;
        }
      }

      if (json.has_more && json.next_page) page = json.next_page;
      else break;
    }
  } catch (e) {
    console.error("getActualCost failed:", e instanceof Error ? e.message : String(e));
    return null;
  }

  return { totalUsd: Number(total.toFixed(2)), byDay, startedAt: startingAt, endedAt: endingAt };
}
