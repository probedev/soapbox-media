/**
 * Channel-candidate vetting - the pure quality predicates the expansion CLI
 * applies before a candidate is shown for human review. Kept dependency-free
 * (no db, no next/server) so it is unit-testable and the single source of truth
 * for the floors. `src/lib/channels.ts` imports `SUB_FLOOR` from here.
 *
 * Curation criteria (from docs/channel-expansion-strategy.md, as amended):
 *   - Reach floor: >= 200K, YOUTUBE ONLY. Podcast reach is editorial/soft
 *     (hand-curated tiers), not measured, so it is never floor-gated.
 *   - Activity: a substantive episode within the last 14 days.
 *   - Lean assignable: surfaced, but assigned by a human during review - a
 *     missing lean does not fail vetting.
 */

import type { Platform } from "./channel-dedup";

/** YouTube subscriber floor for admitting a channel. Single source of truth. */
export const SUB_FLOOR = 200_000;

/** A feed with no episode in this many days is considered stale. */
export const STALE_DAYS = 14;

/**
 * Reach floor, enforced for YouTube only. YouTube subscriber counts are real
 * and API-measured; podcast reach is editorial, so podcasts always pass.
 */
export function meetsReachFloor(platform: Platform, reach: number | null | undefined): boolean {
  if (platform !== "youtube") return true;
  return (reach ?? 0) >= SUB_FLOOR;
}

export function isLeanAssignable(lean: string | null | undefined): lean is "L" | "M" | "R" {
  return lean === "L" || lean === "M" || lean === "R";
}

/** Has the feed published within `staleDays`? Null/unknown recency => false. */
export function isActiveFeed(
  latestEpisodeAt: string | Date | null | undefined,
  now: Date = new Date(),
  staleDays: number = STALE_DAYS,
): boolean {
  if (!latestEpisodeAt) return false;
  const latest = typeof latestEpisodeAt === "string" ? new Date(latestEpisodeAt) : latestEpisodeAt;
  if (isNaN(latest.getTime())) return false;
  const cutoffMs = now.getTime() - staleDays * 24 * 60 * 60 * 1000;
  return latest.getTime() >= cutoffMs;
}

export interface VetInput {
  name: string;
  platform: Platform;
  reach?: number | null;
  political_lean?: string | null;
  /** Most recent episode/upload timestamp; omit if not yet fetched. */
  latest_episode_at?: string | null;
}

export interface VetResult {
  ok: boolean;
  status: "vetted" | "below_floor" | "stale";
  reasons: string[];
}

/**
 * Composite vet. Hard fails: below the YouTube floor, or a KNOWN-stale feed.
 * Recency that has not been fetched yet (latest_episode_at omitted) is treated
 * as "unknown" - surfaced as a reason, not a stale fail - so a freshly
 * discovered candidate is not wrongly marked stale before its feed is read.
 * Lean is a soft signal assigned during review and never blocks vetting.
 */
export function vetCandidate(c: VetInput, now: Date = new Date()): VetResult {
  if (!meetsReachFloor(c.platform, c.reach)) {
    return {
      ok: false,
      status: "below_floor",
      reasons: [`below the ${SUB_FLOOR.toLocaleString()} YouTube subscriber floor`],
    };
  }
  if (c.latest_episode_at != null && !isActiveFeed(c.latest_episode_at, now)) {
    return { ok: false, status: "stale", reasons: [`no episode in ${STALE_DAYS} days`] };
  }
  const reasons: string[] = [];
  if (c.latest_episode_at == null) reasons.push("recency unknown (fetch before approving)");
  if (!isLeanAssignable(c.political_lean)) reasons.push("lean unassigned (assign during review)");
  return { ok: true, status: "vetted", reasons };
}
