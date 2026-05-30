/**
 * Episode ingest script.
 *
 * For each active channel (default: top 3 by reach), fetch the N most recent
 * episodes (default: 5) and upsert into the `episodes` table with
 * transcript_status = 'pending'. Idempotent — re-running skips already-known
 * episodes via the (channel_id, source_url) unique constraint.
 *
 * Run with:   npm run ingest
 * Override:   npm run ingest -- <num-channels> <episodes-per-channel>
 *             e.g. npm run ingest -- 5 10
 *
 * This is the v0 — small-batch, conservative defaults. We tune higher once
 * the pipeline proves stable on a few channels.
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import {
  getRecentUploads,
  getChannelDetailsBatch,
} from "@/lib/youtube";
import {
  getPodcastEpisodes,
  getPodcastById,
  type PodscanPodcast,
} from "@/lib/podscan";
import { dedupKey, loadSiblingEpisodeKeys } from "@/lib/dedup";

interface ChannelRow {
  id: string;
  name: string;
  platform: "youtube" | "podcast";
  platform_id: string;
  political_lean: "L" | "M" | "R";
  reach: number | bigint;
  active: boolean;
}

/** Minimum duration in seconds for an episode to be ingested.
 *  Episodes shorter than this are typically YouTube Shorts, podcast
 *  promos, or trailers — too short for meaningful per-issue sentiment
 *  classification. Setting to 3 minutes per Gregg 2026-05-11. */
const MIN_DURATION_SEC = 180;

/**
 * Same field-fallback as scripts/seed-podcasts.ts:pickReach and the helper
 * in src/lib/pipeline.ts. Duplicated across all three callers because the
 * shape of PodScan's reach surface is the source of truth (varies by
 * podcast); a shared helper in @/lib/podscan would be the cleanup move.
 */
function pickPodscanReach(p: PodscanPodcast): number {
  const candidates: unknown[] = [
    p.reach,
    p.reach_estimate,
    (p as unknown as { audience_size?: number }).audience_size,
    (p as unknown as { monthly_listeners?: number }).monthly_listeners,
    (p as unknown as { audience?: number }).audience,
    (p as unknown as { estimated_audience?: number }).estimated_audience,
  ];
  for (const c of candidates) {
    const n = typeof c === "string" ? parseInt(c, 10) : (c as number);
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

interface IngestResult {
  channel: string;
  platform: string;
  fetched: number;
  newRows: number;
  skippedShort: number;
  skippedDup: number;
  failures: string[];
}

async function ingestYouTubeChannel(
  channel: ChannelRow,
  perChannel: number,
  db: ReturnType<typeof createServiceClient>,
): Promise<IngestResult> {
  const result: IngestResult = {
    channel: channel.name,
    platform: "youtube",
    fetched: 0,
    newRows: 0,
    skippedShort: 0,
    skippedDup: 0,
    failures: [],
  };
  try {
    // YouTube convention: uploads playlist ID = "UU" + the rest of the channel ID.
    // Lets us skip an extra channels.list call to retrieve the uploadsPlaylistId.
    const uploadsPlaylistId = "UU" + channel.platform_id.slice(2);
    // Fetch 2x perChannel to give us buffer against Shorts being filtered out.
    const videos = await getRecentUploads(uploadsPlaylistId, perChannel * 2);
    result.fetched = videos.length;

    const longEnough = videos.filter((v) => (v.durationSec ?? 0) >= MIN_DURATION_SEC);
    result.skippedShort = videos.length - longEnough.length;
    const slice = longEnough.slice(0, perChannel);

    // Skip episodes already ingested on a sibling channel (same show, other
    // platform) — cross-platform re-post dedup.
    const siblingKeys = await loadSiblingEpisodeKeys(db, channel.id, channel.name);

    for (const v of slice) {
      if (siblingKeys.has(dedupKey(v.title, v.publishedAt))) {
        result.skippedDup += 1;
        continue;
      }
      // NOTE: transcript_status intentionally omitted. Postgres uses DEFAULT
      // 'pending' on insert and preserves existing value on update. This
      // prevents re-ingest from resetting already-fetched episodes back to
      // pending and causing redundant transcribe work.
      const { error, data } = await db
        .from("episodes")
        .upsert(
          {
            channel_id: channel.id,
            title: v.title,
            published_at: v.publishedAt,
            source_url: v.url,
            duration_sec: v.durationSec ?? null,
          },
          { onConflict: "channel_id,source_url", ignoreDuplicates: false },
        )
        .select();
      if (error) {
        result.failures.push(`${v.videoId}: ${error.message}`);
      } else if (data && data.length > 0) {
        result.newRows += 1;
      }
    }
  } catch (e: any) {
    result.failures.push(`fetch failed: ${e.message}`);
  }
  return result;
}

interface PodcastIngestResult extends IngestResult {
  transcriptsWritten: number;
}

async function ingestPodcastChannel(
  channel: ChannelRow,
  perChannel: number,
  db: ReturnType<typeof createServiceClient>,
): Promise<PodcastIngestResult> {
  const result: PodcastIngestResult = {
    channel: channel.name,
    platform: "podcast",
    fetched: 0,
    newRows: 0,
    skippedShort: 0,
    skippedDup: 0,
    transcriptsWritten: 0,
    failures: [],
  };
  try {
    const eps = await getPodcastEpisodes(channel.platform_id, perChannel);
    result.fetched = eps.length;

    if (eps.length === 0) {
      result.failures.push(`no episodes returned`);
      return result;
    }

    // Filter out short episodes (typically promos / trailers), then slice to perChannel
    const longEnough = eps.filter((ep) => {
      const dur = ep.episode_duration || ep.duration || ep.duration_seconds || 0;
      return Number(dur) >= MIN_DURATION_SEC;
    });
    result.skippedShort = eps.length - longEnough.length;
    const slice = longEnough.slice(0, perChannel);

    // Skip episodes already ingested on a sibling channel (same show, other
    // platform) — cross-platform re-post dedup.
    const siblingKeys = await loadSiblingEpisodeKeys(db, channel.id, channel.name);

    for (const ep of slice) {
      // Normalize PodScan's episode_-prefixed fields against legacy/alt variants
      const url =
        ep.episode_url ||
        ep.episode_permalink ||
        ep.url ||
        ep.link ||
        ep.episode_audio_url ||
        ep.audio_url;
      const title = ep.episode_title || ep.title || ep.name || "(untitled)";
      const published =
        ep.posted_at ||
        ep.published_at ||
        ep.publish_date ||
        ep.pub_date ||
        ep.release_date ||
        ep.created_at;
      const transcriptText = ep.episode_transcript || ep.transcript || ep.text;
      const duration = ep.episode_duration || ep.duration || ep.duration_seconds;

      if (!url) {
        result.failures.push(
          `episode missing URL. Keys: [${Object.keys(ep).slice(0, 20).join(", ")}]`,
        );
        continue;
      }
      if (!published) {
        result.failures.push(
          `episode missing date. Keys: [${Object.keys(ep).slice(0, 20).join(", ")}]`,
        );
        continue;
      }
      if (siblingKeys.has(dedupKey(String(title), String(published)))) {
        result.skippedDup += 1;
        continue;
      }

      // Write the episode row. transcript_status omitted so Postgres applies
      // DEFAULT 'pending' on insert and preserves existing value on update.
      // If we have an inline transcript we explicitly mark status='fetched'
      // below in a separate update, after writing the transcript row.
      const hasTranscript = !!(transcriptText && String(transcriptText).trim().length > 0);
      const { error, data } = await db
        .from("episodes")
        .upsert(
          {
            channel_id: channel.id,
            title: String(title).slice(0, 500),
            published_at: published,
            source_url: url,
            duration_sec: typeof duration === "number" ? Math.round(duration) : null,
          },
          { onConflict: "channel_id,source_url", ignoreDuplicates: false },
        )
        .select();
      if (error) {
        result.failures.push(`upsert episode: ${error.message}`);
        continue;
      }
      const episodeRow = data?.[0];
      if (!episodeRow) continue;
      result.newRows += 1;

      if (hasTranscript) {
        const { error: txErr } = await db
          .from("transcripts")
          .upsert(
            {
              episode_id: episodeRow.id,
              text: String(transcriptText),
              provider: "podscan",
            },
            { onConflict: "episode_id", ignoreDuplicates: false },
          );
        if (txErr) {
          result.failures.push(`upsert transcript for ${title}: ${txErr.message}`);
        } else {
          // Explicitly mark fetched — separate update so re-ingests don't
          // wipe this status when transcript_status is omitted from the upsert.
          await db
            .from("episodes")
            .update({ transcript_status: "fetched" })
            .eq("id", episodeRow.id);
          result.transcriptsWritten += 1;
        }
      }
    }
  } catch (e: any) {
    result.failures.push(`fetch failed: ${e.message}`);
  }
  return result;
}

async function main() {
  const numChannels = parseInt(process.argv[2] || "3", 10);
  const perChannel = parseInt(process.argv[3] || "5", 10);

  console.log(`\nSoapbox episode ingest`);
  console.log(`─`.repeat(60));
  console.log(`Channels to process: ${numChannels}   Episodes per channel: ${perChannel}\n`);

  const db = createServiceClient();
  const { data: channels, error } = await db
    .from("channels")
    .select("id, name, platform, platform_id, political_lean, reach, active")
    .eq("active", true)
    .order("reach", { ascending: false })
    .limit(numChannels);

  if (error) {
    console.error("Failed to load channels:", error.message);
    process.exit(1);
  }
  if (!channels || channels.length === 0) {
    console.log("No active channels in DB — run `npm run seed:channels` first.");
    return;
  }

  // Batch-fetch live YT stats up front (one API call for up to 50 channels)
  // so each per-channel iteration can write back a fresh reach number. See
  // runIngest in src/lib/pipeline.ts for the same logic on the cron path —
  // both paths refresh reach so manual catchup and scheduled cron stay in
  // sync. (v0.6.57 — was set-once-at-seed before this.)
  const ytChannelIds = (channels as ChannelRow[])
    .filter((c) => c.platform === "youtube")
    .map((c) => c.platform_id);
  let ytStats: Map<
    string,
    { title: string; subscriberCount: number; description: string }
  > = new Map();
  try {
    ytStats = await getChannelDetailsBatch(ytChannelIds);
  } catch (e: any) {
    console.log(`    ⚠ YT batch stats failed: ${e?.message?.slice(0, 80)}`);
  }
  let reachRefreshed = 0;

  const results: IngestResult[] = [];

  for (const channel of channels as ChannelRow[]) {
    console.log(`[${channel.political_lean}] ${channel.name} (${channel.platform}, reach ${Number(channel.reach).toLocaleString()})`);

    // Refresh reach before processing episodes. Only update on positive
    // values — a transient lookup miss shouldn't zero out a known stat.
    try {
      let newReach: number | null = null;
      if (channel.platform === "youtube") {
        const stat = ytStats.get(channel.platform_id);
        if (stat && stat.subscriberCount > 0) newReach = stat.subscriberCount;
      } else {
        const pod = await getPodcastById(channel.platform_id);
        if (pod) {
          const r = pickPodscanReach(pod);
          if (r > 0) newReach = r;
        }
      }
      if (newReach !== null && Number(newReach) !== Number(channel.reach)) {
        await db
          .from("channels")
          .update({
            reach: newReach,
            reach_updated_at: new Date().toISOString(),
          })
          .eq("id", channel.id);
        const delta = newReach - Number(channel.reach);
        const sign = delta > 0 ? "↑" : "↓";
        console.log(
          `    reach: ${Number(channel.reach).toLocaleString()} → ${newReach.toLocaleString()}  ${sign} ${Math.abs(delta).toLocaleString()}`,
        );
        reachRefreshed++;
      } else if (newReach !== null) {
        // Still bump reach_updated_at so we know we checked, even if the
        // number didn't change. Otherwise stale-detection is misleading.
        await db
          .from("channels")
          .update({ reach_updated_at: new Date().toISOString() })
          .eq("id", channel.id);
      }
    } catch (e: any) {
      console.log(`    ⚠ reach refresh: ${e?.message?.slice(0, 60)}`);
    }

    const result: IngestResult =
      channel.platform === "youtube"
        ? await ingestYouTubeChannel(channel, perChannel, db)
        : await ingestPodcastChannel(channel, perChannel, db);

    results.push(result);

    const txWritten = (result as PodcastIngestResult).transcriptsWritten;
    const txLabel = typeof txWritten === "number" ? `, transcripts ${txWritten}` : "";
    const shortLabel = result.skippedShort > 0 ? `, skipped-short ${result.skippedShort}` : "";
    console.log(
      `    fetched ${result.fetched}, new ${result.newRows}${shortLabel}${txLabel}, failures ${result.failures.length}`,
    );
    for (const f of result.failures.slice(0, 3)) {
      console.log(`      ✗ ${f}`);
    }
    if (result.failures.length > 3) {
      console.log(`      ... and ${result.failures.length - 3} more`);
    }
  }

  // Summary
  console.log(`\n${"─".repeat(60)}`);
  const totalFetched = results.reduce((a, r) => a + r.fetched, 0);
  const totalNew = results.reduce((a, r) => a + r.newRows, 0);
  const totalTranscripts = results.reduce(
    (a, r) => a + ((r as PodcastIngestResult).transcriptsWritten || 0),
    0,
  );
  const totalFailed = results.reduce((a, r) => a + r.failures.length, 0);
  console.log(
    `Total: fetched ${totalFetched}, new episodes ${totalNew}, transcripts written ${totalTranscripts}, failures ${totalFailed}, reach refreshed ${reachRefreshed}`,
  );

  const { count: epCount } = await db
    .from("episodes")
    .select("*", { count: "exact", head: true });
  const { count: txCount } = await db
    .from("transcripts")
    .select("*", { count: "exact", head: true });
  console.log(`Episodes table now contains: ${epCount} rows`);
  console.log(`Transcripts table now contains: ${txCount} rows`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
