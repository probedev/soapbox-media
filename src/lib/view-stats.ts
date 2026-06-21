/**
 * Read layer for the Phase-0 view-count transparency surface (MCP, v0.32.0).
 *
 * Exposes, per YouTube channel: "typical views" vs subscriber reach (the
 * blunt-proxy reveal) and the channel's runaway over/under-performing videos.
 * TRANSPARENCY ONLY - none of this feeds the reach weighting or the Index yet
 * (see get_methodology + [[view-count-collection]]).
 *
 * The heavy aggregation (latest snapshot per episode, panel-wide median) lives
 * in the channel_view_stats / episode_view_latest DB views; this module reads
 * them and shapes the per-channel runaways. rankRunaways is pure + unit-tested.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/db";

// Mature window: ~90% of a news video's views land by day 14, so comparing only
// videos aged 14-90d controls the age confound (a fresh video isn't a flop,
// it's just young). Must match channel_view_stats' window in the migration.
export const MATURE_MIN_DAYS = 14;
export const MATURE_MAX_DAYS = 90;
const RUNAWAY_N = 5;

export interface RunawayVideo {
  title: string;
  source_url: string;
  published_at: string;
  views: number;
  /** Views relative to the channel's typical (mature-window median). 3.4 = 3.4x
   *  the norm (a runaway hit); 0.2 = a fifth of the norm (an underperformer). */
  performance: number;
}

export interface ChannelViewStats {
  /** Mature-window median views; the channel's "typical reach per video". */
  typical_views: number;
  sample_size: number;
  /** Median views / subscriber reach. The blunt-proxy divergence; null if reach is 0. */
  views_per_sub: number | null;
  window: string;
  as_of: string;
  note: string;
  /** Biggest over-performers (highest performance multiple) among mature videos. */
  top_videos: RunawayVideo[];
  /** Biggest under-performers (lowest performance multiple) among mature videos. */
  bottom_videos: RunawayVideo[];
}

interface LatestVideoRow {
  title: string;
  source_url: string;
  published_at: string;
  view_count: number | null;
}

/**
 * Rank a channel's mature videos into top over-performers and bottom
 * under-performers by view count relative to `typical`. Pure (no IO) so the
 * ranking/labeling is unit-tested. Videos with no view count are dropped.
 */
export function rankRunaways(
  videos: LatestVideoRow[],
  typical: number,
  n: number = RUNAWAY_N,
): { top: RunawayVideo[]; bottom: RunawayVideo[] } {
  const scored = videos
    .filter((v) => v.view_count != null)
    .map((v) => ({
      title: v.title,
      source_url: v.source_url,
      published_at: v.published_at,
      views: v.view_count as number,
      performance: typical > 0 ? Math.round(((v.view_count as number) / typical) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.views - a.views);
  const top = scored.slice(0, n);
  // Bottom = the n lowest, presented worst-first (most extreme underperformer up top).
  const bottom = scored.slice(Math.max(scored.length - n, n)).reverse();
  return { top, bottom };
}

/**
 * Per-channel view stats + runaways for get_channel_detail. Returns null for
 * channels with no mature-window sample (podcasts, thin/new channels) - the
 * caller surfaces that as "no view data".
 */
export async function getChannelViewStats(
  channelId: string,
  db: SupabaseClient = createServiceClient(),
  now: number = Date.now(),
): Promise<ChannelViewStats | null> {
  const { data: stat, error: statErr } = await db
    .from("channel_view_stats")
    .select("reach, sample_size, typical_views")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (statErr) throw new Error(`getChannelViewStats: ${statErr.message}`);
  if (!stat) return null;

  const minIso = new Date(now - MATURE_MAX_DAYS * 86_400_000).toISOString();
  const maxIso = new Date(now - MATURE_MIN_DAYS * 86_400_000).toISOString();
  const { data: vids, error: vidErr } = await db
    .from("episode_view_latest")
    .select("title, source_url, published_at, view_count")
    .eq("channel_id", channelId)
    .gte("published_at", minIso)
    .lte("published_at", maxIso);
  if (vidErr) throw new Error(`getChannelViewStats videos: ${vidErr.message}`);

  const typical = Number(stat.typical_views);
  const reach = Number(stat.reach);
  const { top, bottom } = rankRunaways((vids || []) as LatestVideoRow[], typical);

  return {
    typical_views: typical,
    sample_size: Number(stat.sample_size),
    views_per_sub: reach > 0 ? Math.round((typical / reach) * 10000) / 10000 : null,
    window: `videos published ${MATURE_MIN_DAYS}-${MATURE_MAX_DAYS} days ago (mature)`,
    as_of: new Date(now).toISOString().slice(0, 10),
    note: "YouTube only; transparency metric, NOT used in the Index weighting (which still weights by subscriber reach).",
    top_videos: top,
    bottom_videos: bottom,
  };
}

/**
 * Panel-wide typical_views + views_per_sub keyed by channel id, for enriching
 * list_channels. One read off the channel_view_stats view.
 */
export async function listChannelViewStats(
  db: SupabaseClient = createServiceClient(),
): Promise<Map<string, { typical_views: number; views_per_sub: number | null }>> {
  const { data, error } = await db
    .from("channel_view_stats")
    .select("channel_id, reach, typical_views");
  if (error) throw new Error(`listChannelViewStats: ${error.message}`);
  const out = new Map<string, { typical_views: number; views_per_sub: number | null }>();
  for (const r of (data || []) as any[]) {
    const typical = Number(r.typical_views);
    const reach = Number(r.reach);
    out.set(r.channel_id, {
      typical_views: typical,
      views_per_sub: reach > 0 ? Math.round((typical / reach) * 10000) / 10000 : null,
    });
  }
  return out;
}
