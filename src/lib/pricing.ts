/**
 * Single source of truth for Anthropic per-model token pricing (USD per 1M
 * tokens) and the cost estimator. Previously these rates were hardcoded in four
 * places (pipeline.ts classify + score, backfill-issues.ts, classify.ts,
 * score.ts) with no shared definition; centralizing them prevents drift and
 * adds cache-token accounting for free.
 *
 * Rates verified against platform.claude.com pricing (2026-06): Sonnet 4.6
 * $3/$15, Haiku 4.5 $1/$5, Opus 4.8 $5/$25 per 1M in/out. Cache multipliers are
 * Anthropic's standard: a cache READ costs 0.1x the input rate, a 5-minute
 * cache WRITE costs 1.25x. These are ESTIMATES from response token counts;
 * reconcile against actual billing via lib/anthropic-billing.ts.
 */
export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { inputPerM: 3, outputPerM: 15 },
  "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },
  "claude-haiku-4-5-20251001": { inputPerM: 1, outputPerM: 5 },
  "claude-opus-4-8": { inputPerM: 5, outputPerM: 25 },
};

/** Used when a model id isn't in the table - Sonnet rate, the costlier of the
 *  two pipeline models, so an unknown model never silently under-counts. */
const FALLBACK: ModelPricing = { inputPerM: 3, outputPerM: 15 };

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Cached-prefix reads (billed at 0.1x input). */
  cacheReadTokens?: number;
  /** Cache-write tokens (billed at 1.25x input for the 5-min TTL). */
  cacheWriteTokens?: number;
}

/** Estimated USD cost of one or many calls to `model`, rounded to 4 decimals. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const p = MODEL_PRICING[model] ?? FALLBACK;
  const inTok = usage.inputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const usd =
    (inTok * p.inputPerM +
      outTok * p.outputPerM +
      cacheRead * p.inputPerM * 0.1 +
      cacheWrite * p.inputPerM * 1.25) /
    1_000_000;
  return Number(usd.toFixed(4));
}
