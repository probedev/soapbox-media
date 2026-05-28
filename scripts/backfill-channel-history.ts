/**
 * Deep-ingest history for specific YouTube channels — used when adding new
 * channels to the panel so they don't start with only the next daily ingest's
 * 3 episodes. Fetches up to N recent uploads via the YT API and upserts into
 * the `episodes` table. The regular transcribe → classify → score crons then
 * catch them up. Idempotent (upsert on channel_id + source_url).
 *
 * Defaults to channels created in the last day (newly-seeded). Costs ~2 YT API
 * quota units per channel. No LLM cost in this step — downstream pipeline is
 * what costs (and it's bounded by per-stage limits + the 300s/240s budgets).
 *
 * Run:  npm run backfill:channel-history             (last-day-seeded, 30/ch)
 *       npm run backfill:channel-history -- 30 <id1,id2>
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getRecentUploads } from "@/lib/youtube";

const MIN_DURATION_SEC = 180;

async function main() {
  const perChannel = parseInt(process.argv[2] || "30", 10);
  const idsArg = process.argv[3];

  const db = createServiceClient();
  let channels: { id: string; name: string; platform_id: string; reach: number }[] = [];

  if (idsArg) {
    const ids = idsArg.split(",").map((s) => s.trim()).filter(Boolean);
    const { data } = await db
      .from("channels")
      .select("id, name, platform_id, reach")
      .eq("platform", "youtube")
      .in("platform_id", ids);
    channels = (data || []) as any[];
  } else {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 1);
    const { data } = await db
      .from("channels")
      .select("id, name, platform_id, reach")
      .eq("platform", "youtube")
      .eq("active", true)
      .gte("created_at", since.toISOString());
    channels = (data || []) as any[];
  }

  console.log(`\nBackfill channel history — ${channels.length} channels, up to ${perChannel} episodes each\n`);
  if (channels.length === 0) {
    console.log("No matching channels.");
    return;
  }

  let totalFetched = 0;
  let totalNew = 0;
  let totalSkippedShort = 0;
  let totalFailures = 0;

  for (const ch of channels) {
    try {
      const uploadsPlaylistId = "UU" + ch.platform_id.slice(2);
      const videos = await getRecentUploads(uploadsPlaylistId, perChannel);
      totalFetched += videos.length;
      const longEnough = videos.filter((v) => (v.durationSec ?? 0) >= MIN_DURATION_SEC);
      const short = videos.length - longEnough.length;
      totalSkippedShort += short;

      let chNew = 0;
      for (const v of longEnough) {
        const { error, data } = await db
          .from("episodes")
          .upsert(
            {
              channel_id: ch.id,
              title: v.title,
              published_at: v.publishedAt,
              source_url: v.url,
              duration_sec: v.durationSec ?? null,
            },
            { onConflict: "channel_id,source_url", ignoreDuplicates: false },
          )
          .select();
        if (error) totalFailures++;
        else if (data && data.length > 0) {
          // .select() returns the row whether inserted or updated; to count NEW
          // we'd need to check existence first. Approximate: upsert returns row
          // either way. For a fresh channel everything is new. Acceptable.
          chNew++;
        }
      }
      totalNew += chNew;
      console.log(`  ${ch.name.padEnd(40)} fetched ${videos.length}, kept ${longEnough.length}, short ${short}`);
    } catch (e: any) {
      console.warn(`  [${ch.name}] failed: ${e.message}`);
      totalFailures++;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Channels: ${channels.length} · fetched ${totalFetched} · kept ${totalFetched - totalSkippedShort} (skipped ${totalSkippedShort} short) · upserted ${totalNew} · failures ${totalFailures}`);
  console.log(`\nTranscribe + classify + score crons will catch them up over the next ~1–3 days.`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
