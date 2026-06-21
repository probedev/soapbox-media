/**
 * Helpers for writing to and reading from the usage_log table. Used by:
 * - the Vercel cron pipeline endpoint (records each daily run)
 * - the /admin/costs dashboard (visualizes run-rate and burn vs budget)
 */
import { createServiceClient } from "./db";

export interface UsageLogRow {
  id: string;
  ran_at: string;
  duration_ms: number;
  source: "cron" | "cli" | "manual";
  ingest_episodes_fetched: number;
  ingest_episodes_new: number;
  ingest_failures: number;
  transcribe_succeeded: number;
  transcribe_failed: number;
  classify_processed: number;
  classify_mentions: number;
  classify_failures: number;
  score_succeeded: number;
  score_failed: number;
  anthropic_input_tokens: number;
  anthropic_output_tokens: number;
  anthropic_cost_usd: number;
  raw_summary: unknown;
  error_message: string | null;
}

interface PipelineSummary {
  totalDurationMs: number;
  stages?: {
    ingest?: { detail?: any };
    transcribe?: { detail?: any };
    classify?: { detail?: any };
    score?: { detail?: any };
    /** Emerging-favorability scoring. Its own cron; folded into the cost columns
     *  below so /admin/costs counts its (small) spend against the budget. */
    "score-emerging"?: { detail?: any };
    /** Phase-0 view-count snapshots (v0.32.0). No LLM cost - logged for run
     *  history only, contributes nothing to the token/cost columns. */
    metrics?: { detail?: any };
  };
}

/**
 * Persist a pipeline run to usage_log. Called at the end of the cron
 * endpoint with the JSON summary it produced.
 */
export async function recordPipelineRun(
  summary: PipelineSummary,
  source: "cron" | "cli" | "manual" = "cron",
): Promise<void> {
  const db = createServiceClient();

  const ingest = summary.stages?.ingest?.detail || {};
  const transcribe = summary.stages?.transcribe?.detail || {};
  const classify = summary.stages?.classify?.detail || {};
  const score = summary.stages?.score?.detail || {};
  const scoreEmerging = summary.stages?.["score-emerging"]?.detail || {};

  const inputTokens =
    (Number(classify.inputTokens) || 0) +
    (Number(score.inputTokens) || 0) +
    (Number(scoreEmerging.inputTokens) || 0);
  const outputTokens =
    (Number(classify.outputTokens) || 0) +
    (Number(score.outputTokens) || 0) +
    (Number(scoreEmerging.outputTokens) || 0);
  const cost =
    (Number(classify.approxCostUsd) || 0) +
    (Number(score.approxCostUsd) || 0) +
    (Number(scoreEmerging.approxCostUsd) || 0);

  const { error } = await db.from("usage_log").insert({
    duration_ms: summary.totalDurationMs || 0,
    source,
    ingest_episodes_fetched: Number(ingest.fetched) || 0,
    ingest_episodes_new: Number(ingest.newEpisodes) || 0,
    ingest_failures: Number(ingest.failures) || 0,
    transcribe_succeeded: Number(transcribe.succeeded) || 0,
    transcribe_failed: Number(transcribe.failed) || 0,
    classify_processed: Number(classify.processed) || 0,
    classify_mentions: Number(classify.mentions) || 0,
    classify_failures: Number(classify.failed) || 0,
    score_succeeded: Number(score.succeeded) || 0,
    score_failed: Number(score.failed) || 0,
    anthropic_input_tokens: inputTokens,
    anthropic_output_tokens: outputTokens,
    anthropic_cost_usd: cost,
    raw_summary: summary,
  });

  if (error) {
    // Don't fail the cron just because logging failed - log to console.
    console.error("recordPipelineRun: failed to persist usage_log:", error.message);
  }
}

/**
 * Persist a one-off CLI / manual script run (a backfill, a manual classify or
 * score drain) to usage_log so /admin/costs captures terminal spend, not just
 * the daily cron. Maps the script's totals onto the same columns the cron path
 * uses and tags `source` so the dashboard separates recurring from one-off.
 * Best-effort: a logging failure never fails the script.
 */
export async function recordScriptRun(opts: {
  label: string;
  source?: "cli" | "manual";
  durationMs?: number;
  classify?: { processed?: number; mentions?: number; failed?: number };
  score?: { succeeded?: number; failed?: number };
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  raw?: Record<string, unknown>;
}): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("usage_log").insert({
    duration_ms: Math.round(opts.durationMs ?? 0),
    source: opts.source ?? "manual",
    ingest_episodes_fetched: 0,
    ingest_episodes_new: 0,
    ingest_failures: 0,
    transcribe_succeeded: 0,
    transcribe_failed: 0,
    classify_processed: opts.classify?.processed ?? 0,
    classify_mentions: opts.classify?.mentions ?? 0,
    classify_failures: opts.classify?.failed ?? 0,
    score_succeeded: opts.score?.succeeded ?? 0,
    score_failed: opts.score?.failed ?? 0,
    anthropic_input_tokens: opts.inputTokens ?? 0,
    anthropic_output_tokens: opts.outputTokens ?? 0,
    anthropic_cost_usd: opts.costUsd ?? 0,
    raw_summary: { label: opts.label, ...(opts.raw ?? {}) },
  });
  if (error) {
    console.error("recordScriptRun: failed to persist usage_log:", error.message);
  }
}

/** Recent usage_log rows, most recent first. */
export async function getRecentUsage(limit = 60): Promise<UsageLogRow[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("usage_log")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("getRecentUsage:", error.message);
    return [];
  }
  return (data || []) as UsageLogRow[];
}

export interface UsageSummary {
  /** All-time totals */
  totalRuns: number;
  totalCost: number;
  /** Rolling windows */
  todayCost: number;
  last7dCost: number;
  last30dCost: number;
  /** Last 30 daily-bucketed costs, oldest first. Days with no runs = 0. */
  dailySeries: { date: string; cost: number; runs: number }[];
  /** Projected monthly run-rate based on last-7-day average × 30 (all sources) */
  projectedMonthlyCost: number;
  /** Recurring monthly run-rate from CRON rows only (last-7d cron avg × 30).
   *  This is the budget-relevant number - one-off backfills shouldn't inflate it. */
  recurringMonthlyCost: number;
  /** One-off / manual (non-cron) spend over the last 30 days. */
  oneOffLast30dCost: number;
  /** Most recent N runs for the table */
  recentRuns: UsageLogRow[];
}

/**
 * Roll up usage_log into the shapes the dashboard needs.
 */
export async function getUsageSummary(): Promise<UsageSummary> {
  const rows = await getRecentUsage(500); // give us plenty for 30d rollup
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayAgo = now - dayMs;
  const weekAgo = now - 7 * dayMs;
  const monthAgo = now - 30 * dayMs;

  const cost = (r: UsageLogRow) => Number(r.anthropic_cost_usd) || 0;
  const inRange = (r: UsageLogRow, cutoff: number) =>
    new Date(r.ran_at).getTime() >= cutoff;

  const totalCost = rows.reduce((a, r) => a + cost(r), 0);
  const todayCost = rows.filter((r) => inRange(r, dayAgo)).reduce((a, r) => a + cost(r), 0);
  const last7dCost = rows.filter((r) => inRange(r, weekAgo)).reduce((a, r) => a + cost(r), 0);
  const last30dCost = rows.filter((r) => inRange(r, monthAgo)).reduce((a, r) => a + cost(r), 0);

  // Bucket last 30 days into daily series (oldest first)
  const dailySeries: { date: string; cost: number; runs: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = now - (i + 1) * dayMs;
    const dayEnd = now - i * dayMs;
    const dayRows = rows.filter((r) => {
      const t = new Date(r.ran_at).getTime();
      return t >= dayStart && t < dayEnd;
    });
    const date = new Date(dayStart).toISOString().slice(0, 10);
    dailySeries.push({
      date,
      cost: dayRows.reduce((a, r) => a + cost(r), 0),
      runs: dayRows.length,
    });
  }

  // Projected monthly run-rate from rolling 7-day average × 30 (all sources)
  const projectedMonthlyCost = (last7dCost / 7) * 30;

  // Recurring run-rate excludes one-off/manual spend (backfills etc.) so a
  // single big backfill doesn't blow up the budget projection. Cron is the
  // default/legacy source, so treat a missing source as cron.
  const isCron = (r: UsageLogRow) => (r.source ?? "cron") === "cron";
  const cron7dCost = rows
    .filter((r) => isCron(r) && inRange(r, weekAgo))
    .reduce((a, r) => a + cost(r), 0);
  const recurringMonthlyCost = (cron7dCost / 7) * 30;
  const oneOffLast30dCost = rows
    .filter((r) => !isCron(r) && inRange(r, monthAgo))
    .reduce((a, r) => a + cost(r), 0);

  return {
    totalRuns: rows.length,
    totalCost,
    todayCost,
    last7dCost,
    last30dCost,
    dailySeries,
    projectedMonthlyCost,
    recurringMonthlyCost,
    oneOffLast30dCost,
    recentRuns: rows.slice(0, 30),
  };
}
