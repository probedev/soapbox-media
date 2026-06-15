/**
 * Pure scoring math - the numbers behind the Soapbox Index and the Biggest
 * Movers board. No DB, no env: safe to unit-test (see scoring.test.ts). Kept
 * separate from aggregate.ts (which does the DB reads) so the math can be locked
 * in isolation. The reach weighting here is shared by the emerging-issue score
 * too ([[emerging-score]]).
 */

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** log10 reach weight, floored at reach 10 so tiny channels still count a little. */
export function reachFactor(reach: number): number {
  return Math.log10(Math.max(reach, 10));
}

/** Minimal row shape weightedLean needs; aggregate's ScoreRow satisfies it structurally. */
export interface LeanRow {
  sentiment: number;
  intensity: number;
  channel_reach: number;
}

/** Reach x intensity weighted mean sentiment over a set of scored mentions. */
export function weightedLean(rows: LeanRow[]): { lean: number; weight: number } {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of rows) {
    const w = reachFactor(r.channel_reach) * r.intensity;
    weightedSum += w * r.sentiment;
    totalWeight += w;
  }
  return { lean: totalWeight > 0 ? weightedSum / totalWeight : 0, weight: totalWeight };
}

/** Map a weighted lean (~-5..+5) onto the published Soapbox Index scale, -10..+10. */
export function toIndexScale(lean: number): number {
  return clamp(lean * 2, -10, 10);
}

// ── Biggest Movers: eligibility + ranking ────────────────────────────────────
export const MOVER_MIN_MENTIONS = 25;
export const MOVER_LEAN_DELTA_FLOOR = 0.5;
export const MOVER_VOLUME_RATIO_UP = 1.5;
export const MOVER_VOLUME_RATIO_DOWN = 1 / MOVER_VOLUME_RATIO_UP; // ≈ 0.667
export const MOVER_MAX_ROWS = 6;

/** Both windows need enough mentions or the swing / ratio is too noisy to headline. */
export function moverHasEnoughMentions(currentMentions: number, prevMentions: number): boolean {
  return currentMentions >= MOVER_MIN_MENTIONS && prevMentions >= MOVER_MIN_MENTIONS;
}

/** Earns a row if EITHER the lean swing or the volume ratio clears its threshold. */
export function moverIsInteresting(leanDelta: number, volumeRatio: number): boolean {
  return (
    Math.abs(leanDelta) >= MOVER_LEAN_DELTA_FLOOR ||
    volumeRatio >= MOVER_VOLUME_RATIO_UP ||
    volumeRatio <= MOVER_VOLUME_RATIO_DOWN
  );
}

/**
 * Rank score: max(|leanΔ|/2, |log2(volumeRatio)|). Each axis is scaled so a
 * 2-point lean swing and a 2x volume swing carry equal ranking weight; log2 keeps
 * "doubled" and "halved" symmetric (both score 1.0).
 */
export function moverScore(leanDelta: number, volumeRatio: number): number {
  return Math.max(Math.abs(leanDelta) / 2, Math.abs(Math.log2(volumeRatio)));
}
