/**
 * Canonical show grouping - the single home for "these channel rows are the same
 * show." A show legitimately tracked on both YouTube and a podcast feed is two
 * rows (by design, see channel-dedup.ts); for reach-favoring and for the
 * "who moved this issue" chart we need to collapse those siblings back into one
 * show. Both callers key on the SAME normalizer (`normalizeName`) so they can
 * never drift apart.
 *
 * Pure + dependency-light (no db) so it is unit-testable and importable anywhere.
 * The within-group aggregation (sum weights, pick a display name, etc.) is the
 * caller's job - this owns only the grouping/identity.
 */
import { normalizeName, type Platform } from "./channel-dedup";

/** Canonical identity key for a show name. The one normalizer everyone shares. */
export function canonicalShowKey(name: string): string {
  return normalizeName(name);
}

/** Minimal row shape the grouping needs; richer rows satisfy it structurally. */
export interface ShowRow {
  name: string;
  platform: Platform;
  reach: number;
}

/**
 * Group rows into canonical shows by normalized name, preserving input order of
 * first appearance. Returns one entry per show with its member rows.
 */
export function groupByCanonicalShow<T extends ShowRow>(
  rows: T[],
): { key: string; members: T[] }[] {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of rows) {
    const key = canonicalShowKey(r.name);
    if (!key) continue; // an all-stopword / empty name can't be canonicalized
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(r);
    } else {
      byKey.set(key, [r]);
      order.push(key);
    }
  }
  return order.map((key) => ({ key, members: byKey.get(key)! }));
}

/**
 * The reach a show should be weighted by: prefer the highest YouTube subscriber
 * count (measured, daily-refreshed) over any podcast estimate; fall back to the
 * highest reach on any platform when there is no YouTube row. This is the rule
 * behind reach-favoring (Workstream A) and the chart's per-show reach.
 */
export function preferredShowReach<T extends ShowRow>(members: T[]): number {
  const yt = members.filter((m) => m.platform === "youtube").map((m) => m.reach);
  if (yt.length) return Math.max(...yt);
  return Math.max(0, ...members.map((m) => m.reach));
}
