/**
 * Deep-ingest history for YouTube channels, sampled at a per-day cap so a
 * high-volume channel (e.g. Fox ~25 uploads/day) is backfilled at the same
 * cadence as everyone else (~3/day) instead of flooding the window. This keeps
 * the Index "stance per audience" — posting frequency is capped so the loudest
 * poster can't dominate (matches the ongoing INGEST_PER_CHANNEL=3 cron cap).
 *
 * For each channel: walk the uploads playlist back `days` days, keep videos
 * ≥ MIN_DURATION_SEC, then keep at most `perDay` per calendar day (most recent
 * first). Upsert into `episodes`; the transcribe → classify → score crons (or
 * `npm run drain`) catch them up.
 *
 * Run:  npm run backfill:channel-history                      (3/day, 30 days, last-day-seeded channels)
 *       npm run backfill:channel-history -- 3 30 <id1,id2>    (perDay, days, platform_ids)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getUploadsSince } from "@/lib/youtube";

const MIN_DURATION_SEC = 126; // admits curated short-form; mirrors pipeline.ts

async function main() {
  const perDay = parseInt(process.argv[2] || "3", 10);
  const days = parseInt(process.argv[3] || "30", 10);
  const idsArg = process.argv[4];

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

  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  console.log(
    `\nBackfill — ${channels.length} channels · ${days}d window · cap ${perDay}/day\n`,
  );
  if (channels.length === 0) {
    console.log("No matching channels.");
    return;
  }

  let totalUpserted = 0;
  let totalFailures = 0;

  for (const ch of channels) {
    try {
      const uploadsPlaylistId = "UU" + ch.platform_id.slice(2);
      const videos = await getUploadsSince(uploadsPlaylistId, sinceIso);
      const longEnough = videos.filter((v) => (v.durationSec ?? 0) >= MIN_DURATION_SEC);

      // Per-day cap: videos come newest-first, so the first `perDay` of each
      // calendar day are the latest uploads that day.
      const perDayCount = new Map<string, number>();
      const sampled = longEnough.filter((v) => {
        const day = v.publishedAt.slice(0, 10);
        const n = perDayCount.get(day) ?? 0;
        if (n >= perDay) return false;
        perDayCount.set(day, n + 1);
        return true;
      });

      let chUpserted = 0;
      for (const v of sampled) {
        const { error } = await db.from("episodes").upsert(
          {
            channel_id: ch.id,
            title: v.title,
            published_at: v.publishedAt,
            source_url: v.url,
            duration_sec: v.durationSec ?? null,
          },
          { onConflict: "channel_id,source_url", ignoreDuplicates: false },
        );
        if (error) totalFailures++;
        else chUpserted++;
      }
      totalUpserted += chUpserted;
      console.log(
        `  ${ch.name.padEnd(24)} window ${videos.length} · long ${longEnough.length} · sampled ${sampled.length} (${perDayCount.size} days)`,
      );
    } catch (e: any) {
      console.warn(`  [${ch.name}] failed: ${e.message}`);
      totalFailures++;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Channels: ${channels.length} · upserted ${totalUpserted} · failures ${totalFailures}`);
  console.log(`\nRun \`npm run drain\` to transcribe → classify → score them now.`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
