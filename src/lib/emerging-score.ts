/**
 * Pure scoring math for the /emerging board - recency decay, the week-over-week
 * "breaking" velocity, and the momentum-blended emerging score. No DB, no env:
 * unit-tested in emerging-score.test.ts. The orchestration (DB reads, clustering,
 * the board build) lives in discovery.ts, which imports these.
 */
import { reachFactor } from "./scoring";

// Recency: each member topic's reach contribution halves every
// RECENCY_HALF_LIFE_DAYS of episode age (published_at). Tuned on the live set.
export const RECENCY_HALF_LIFE_DAYS = 7;

/** Reach contribution of one member topic, decayed by episode age. */
export function topicWeight(reach: number, publishedAt: string, now: number): number {
  const ageDays = Math.max((now - new Date(publishedAt).getTime()) / 86_400_000, 0);
  return reachFactor(reach) * Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
}

// "Breaking" velocity: roughly doubled week-over-week off a non-trivial base.
export const BREAKING_MIN_RECENT = 8; // min mentions in the last 7d to be eligible
export const BREAKING_RATIO = 2; // recent7 / prior7 threshold (>= 2 = doubled)

export interface Velocity {
  breaking: boolean;
  /** recent7 / prior7, 1 dp; null when prior7 == 0 (a brand-new surge). */
  ratio: number | null;
  recent7: number;
  prior7: number;
}

/** Classify a cohort's week-over-week counts into the "breaking" signal. */
export function computeVelocity(recent7: number, prior7: number): Velocity {
  if (recent7 < BREAKING_MIN_RECENT) {
    return { breaking: false, ratio: prior7 > 0 ? Number((recent7 / prior7).toFixed(1)) : null, recent7, prior7 };
  }
  if (prior7 === 0) {
    return { breaking: true, ratio: null, recent7, prior7 }; // brand-new surge
  }
  const r = recent7 / prior7;
  return { breaking: r >= BREAKING_RATIO, ratio: Number(r.toFixed(1)), recent7, prior7 };
}

// Emerging sort key = decayed reach-volume x smoothed week-over-week momentum, so
// an accelerating issue outranks a bigger-but-plateaued one. Laplace smoothing
// keeps a tiny topic with a near-zero prior week from getting an explosive ratio.
export const EMERGING_MOMENTUM_SMOOTHING = 3;

/** Public-board sort key: decayed reach-volume tilted by smoothed momentum. */
export function emergingScore(weight: number, recent7: number, prior7: number): number {
  const k = EMERGING_MOMENTUM_SMOOTHING;
  return weight * ((recent7 + k) / (prior7 + k));
}
