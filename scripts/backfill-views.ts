/**
 * One-time view-count backfill.
 *
 * Records the CURRENT cumulative view count for every active YouTube episode as
 * a single episode_metrics snapshot (today's captured_on). This is a baseline:
 * the readings are at heterogeneous ages (age_hours is stored on each row so
 * they stay interpretable), and "views at t+7d" can only be reconstructed
 * forward - hence the daily `metrics` stage going forward. Idempotent: re-runs
 * the same day no-op via the (episode_id, captured_on) upsert.
 *
 * Run with:   npm run backfill:views
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getVideoStatsBatch } from "@/lib/youtube";
import { snapshotEpisodeViews, videoIdFromUrl, type MetricSnapshot } from "@/lib/metrics";

const BATCH = 50; // videos.list caps at 50 ids/call

(async () => {
  const db = createServiceClient();

  const { data: chans, error: chErr } = await db
    .from("channels")
    .select("id")
    .eq("active", true)
    .eq("platform", "youtube");
  if (chErr) throw new Error(`load channels: ${chErr.message}`);
  const ytIds = (chans || []).map((c) => c.id);
  if (ytIds.length === 0) {
    console.log("No active YouTube channels.");
    return;
  }

  // Page ALL episodes for those channels (no date filter - it's a full backfill).
  const eps: { id: string; source_url: string; published_at: string }[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("episodes")
      .select("id, source_url, published_at")
      .in("channel_id", ytIds)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`load episodes: ${error.message}`);
    if (!data || data.length === 0) break;
    eps.push(...(data as any));
  }

  const items = eps
    .map((e) => ({ ep: e, vid: videoIdFromUrl(e.source_url) }))
    .filter((x): x is { ep: (typeof eps)[number]; vid: string } => !!x.vid);

  console.log(
    `Backfilling views for ${items.length} YouTube episodes (${eps.length} total, ${
      eps.length - items.length
    } unparseable URLs skipped)...`,
  );

  let calls = 0;
  let snapshotted = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const stats = await getVideoStatsBatch(chunk.map((c) => c.vid));
    calls++;
    const rows: MetricSnapshot[] = [];
    for (const c of chunk) {
      const s = stats.get(c.vid);
      if (s) rows.push({ episodeId: c.ep.id, publishedAt: c.ep.published_at, stats: s });
    }
    snapshotted += await snapshotEpisodeViews(db, rows);
    if (i % 500 === 0) console.log(`  ${i}/${items.length} (snapshots: ${snapshotted})`);
  }

  console.log(`Done. ${calls} API calls, ${snapshotted} snapshots written.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
