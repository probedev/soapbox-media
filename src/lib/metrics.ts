/**
 * Per-video view-count snapshots (Phase 0: collection only).
 *
 * Banks each YouTube episode's view-growth curve into `episode_metrics` (one
 * snapshot per episode per UTC day) so we can LATER decide whether/how to fold
 * realized views into the reach weighting. NOTHING here is read by
 * src/lib/aggregate.ts - the reach algorithm and the published Index are
 * untouched. See the 20260620130000_episode_metrics.sql migration and
 * [[reach-weighting-sqrt-and-cohort-scope]].
 *
 * Pure helpers (videoIdFromUrl, ageHours) live here so they're unit-testable;
 * the `metrics` stage itself lives in pipeline.ts with the other stages.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VideoStats } from "./youtube";

/** Extract the YouTube video id from a watch/short URL, or null if unparseable. */
export function videoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace(/^\//, "") || null;
    }
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

/** Whole hours since publish at capture time. Floored, never negative. Stored on
 *  every snapshot so heterogeneous-age readings (esp. the one-time backfill)
 *  stay alignable on a "hours since publish" axis for the curve analysis. */
export function ageHours(publishedAt: string | Date, now: number = Date.now()): number {
  const t = (publishedAt instanceof Date ? publishedAt : new Date(publishedAt)).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 3_600_000));
}

export interface MetricSnapshot {
  episodeId: string;
  publishedAt: string;
  stats: VideoStats;
}

/**
 * Upsert one day's view snapshot per episode. Idempotent on
 * (episode_id, captured_on): the first reading of a UTC day wins, repeat runs
 * no-op (ON CONFLICT DO NOTHING). `captured_on`/`captured_at` are DB defaults.
 * Returns the number of NEW snapshot rows written.
 */
export async function snapshotEpisodeViews(
  db: SupabaseClient,
  rows: MetricSnapshot[],
  now: number = Date.now(),
): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({
    episode_id: r.episodeId,
    age_hours: ageHours(r.publishedAt, now),
    view_count: r.stats.viewCount,
    like_count: r.stats.likeCount,
    comment_count: r.stats.commentCount,
  }));
  const { data, error } = await db
    .from("episode_metrics")
    .upsert(payload, { onConflict: "episode_id,captured_on", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`snapshotEpisodeViews: ${error.message}`);
  return data?.length ?? 0;
}
