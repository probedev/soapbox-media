/**
 * Targeted podcast re-ingest by channel name.
 *
 * One-off recovery tool for shows whose episodes previously collapsed onto a
 * single row (network-distributed feeds return a generic homepage for
 * episode_url, which the old ingest keyed source_url on; see the
 * episodeSourceUrl() fix). After deleting the stuck "ghost" row, run this to
 * pull the recent episodes PodScan still returns, now keyed on the unique
 * audio URL. Mirrors ingestPodcastChannel in scripts/ingest.ts (dedup +
 * inline-transcript handling) but scoped to named channels.
 *
 * Classify/score happen on the normal cron afterward.
 *
 *   npm run reingest:podcast                       # the 3 known-affected shows
 *   npm run reingest:podcast -- "Show Name" 25     # one show, 25 episodes
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getPodcastEpisodes, episodeSourceUrl } from "@/lib/podscan";
import { dedupKey, loadSiblingEpisodeKeys } from "@/lib/dedup";

const MIN_DURATION_SEC = 126; // mirrors scripts/ingest.ts + pipeline.ts

const DEFAULT_NAMES = [
  "The Megyn Kelly Show",
  "Call Me Back with Dan Senor",
  "The Daily Beans",
];

async function main() {
  const argNames = process.argv[2] ? [process.argv[2]] : DEFAULT_NAMES;
  const perChannel = parseInt(process.argv[3] || "25", 10);

  const db = createServiceClient();
  const { data: channels, error } = await db
    .from("channels")
    .select("id, name, platform, platform_id")
    .eq("platform", "podcast")
    .in("name", argNames);

  if (error) {
    console.error("Failed to load channels:", error.message);
    process.exit(1);
  }
  if (!channels || channels.length === 0) {
    console.log("No matching podcast channels found.");
    return;
  }

  for (const ch of channels) {
    console.log(`\n${ch.name} (${ch.platform_id})`);
    let eps: any[] = [];
    try {
      eps = await getPodcastEpisodes(ch.platform_id, perChannel);
    } catch (e: any) {
      console.log(`  ✗ fetch failed: ${e.message}`);
      continue;
    }
    const longEnough = eps.filter((ep) => {
      const dur = ep.episode_duration || ep.duration || ep.duration_seconds || 0;
      return Number(dur) >= MIN_DURATION_SEC;
    });
    const siblingKeys = await loadSiblingEpisodeKeys(db, ch.id, ch.name, ch.platform);

    let newRows = 0;
    let transcripts = 0;
    let skippedDup = 0;
    const failures: string[] = [];

    for (const ep of longEnough.slice(0, perChannel)) {
      const url = episodeSourceUrl(ep);
      const title = ep.episode_title || ep.title || ep.name || "(untitled)";
      const published =
        ep.posted_at || ep.published_at || ep.publish_date || ep.pub_date || ep.created_at;
      const transcriptText = ep.episode_transcript || ep.transcript || ep.text;
      const duration = ep.episode_duration || ep.duration || ep.duration_seconds;

      if (!url || !published) {
        failures.push(`missing url/date for "${String(title).slice(0, 40)}"`);
        continue;
      }
      if (siblingKeys.has(dedupKey(String(title), String(published)))) {
        skippedDup++;
        continue;
      }

      const hasTranscript = !!(transcriptText && String(transcriptText).trim().length > 0);
      const { error: upErr, data } = await db
        .from("episodes")
        .upsert(
          {
            channel_id: ch.id,
            title: String(title).slice(0, 500),
            published_at: published,
            source_url: url,
            duration_sec: typeof duration === "number" ? Math.round(duration) : null,
          },
          { onConflict: "channel_id,source_url", ignoreDuplicates: false },
        )
        .select();
      if (upErr) {
        failures.push(`upsert: ${upErr.message}`);
        continue;
      }
      const row = data?.[0];
      if (!row) continue;
      newRows++;

      if (hasTranscript) {
        const { error: txErr } = await db
          .from("transcripts")
          .upsert(
            { episode_id: row.id, text: String(transcriptText), provider: "podscan" },
            { onConflict: "episode_id", ignoreDuplicates: false },
          );
        if (txErr) {
          failures.push(`transcript: ${txErr.message}`);
        } else {
          await db.from("episodes").update({ transcript_status: "fetched" }).eq("id", row.id);
          transcripts++;
        }
      }
    }

    console.log(
      `  fetched ${eps.length}, written ${newRows}, transcripts ${transcripts}, skipped-dup ${skippedDup}, failures ${failures.length}`,
    );
    for (const f of failures.slice(0, 3)) console.log(`    ✗ ${f}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
