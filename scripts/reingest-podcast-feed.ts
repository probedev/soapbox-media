/**
 * Re-ingest recent episodes for podcast channels already in the panel, keyed on
 * a per-episode-unique source_url. Use after fixing a channel's platform_id or
 * when a feed's episodes collapsed onto one row because the feed exposes a
 * show-level URL on every item (the MS NOW / NBC News case — see
 * [[legacy-anchor-seed]]). Idempotent: re-running upserts the same rows.
 *
 * Run:  npx tsx scripts/reingest-podcast-feed.ts "All In with Chris Hayes" "Deadline: White House"
 *       npx tsx scripts/reingest-podcast-feed.ts            (defaults to the 4 MS NOW feeds)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getPodcastEpisodes } from "@/lib/podscan";

const MIN_DURATION_SEC = 180;

const DEFAULT_NAMES = [
  "The Rachel Maddow Show",
  "All In with Chris Hayes",
  "Deadline: White House",
  "The Beat with Ari Melber",
];

/** Same unique-key logic as scripts/seed-legacy-anchors.ts:uniqueSourceUrl. */
function uniqueSourceUrl(ep: any): string | null {
  const audio = ep.episode_audio_url || ep.episode_audio_url_normalized || ep.audio_url;
  const link = ep.episode_url || ep.episode_permalink || ep.url;
  const guid = ep.episode_guid || ep.episode_id;
  if (audio) return String(audio);
  if (link && guid) return `${link}#${guid}`;
  return link || (guid ? `podscan:${guid}` : null);
}

async function main() {
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const targets = names.length ? names : DEFAULT_NAMES;
  const db = createServiceClient();

  const { data: channels } = await db
    .from("channels")
    .select("id, name, platform_id, platform")
    .in("name", targets)
    .eq("platform", "podcast");

  if (!channels || channels.length === 0) {
    console.log("No matching podcast channels for:", targets.join(", "));
    return;
  }

  console.log(`\nRe-ingesting ${channels.length} feed(s) (unique audio-URL key).\n`);
  let grandEps = 0, grandTx = 0;

  for (const c of channels as any[]) {
    let kept = 0, transcripts = 0, collisions = 0;
    const seen = new Set<string>();
    try {
      const eps = (await getPodcastEpisodes(c.platform_id, 30)) as any[];
      for (const ep of eps) {
        const url = uniqueSourceUrl(ep);
        const title = ep.episode_title || ep.title || "(untitled)";
        const published = ep.posted_at || ep.published_at || ep.created_at;
        const duration = ep.episode_duration ?? ep.duration ?? 0;
        const transcriptText = ep.episode_transcript || ep.transcript || ep.text;
        if (!url || !published) continue;
        if (Number(duration) < MIN_DURATION_SEC) continue;
        if (seen.has(url)) { collisions++; continue; }
        seen.add(url);
        const { data: epData, error: epErr } = await db
          .from("episodes")
          .upsert(
            {
              channel_id: c.id,
              title: String(title).slice(0, 500),
              published_at: published,
              source_url: url,
              duration_sec: typeof duration === "number" ? Math.round(duration) : null,
            },
            { onConflict: "channel_id,source_url", ignoreDuplicates: false },
          )
          .select();
        if (epErr || !epData?.[0]) continue;
        kept++;
        if (transcriptText && String(transcriptText).trim().length > 0) {
          const { error: txErr } = await db.from("transcripts").upsert(
            { episode_id: epData[0].id, text: String(transcriptText), provider: "podscan" },
            { onConflict: "episode_id", ignoreDuplicates: false },
          );
          if (!txErr) {
            transcripts++;
            await db.from("episodes").update({ transcript_status: "fetched" }).eq("id", epData[0].id);
          }
        }
      }
      grandEps += kept;
      grandTx += transcripts;
      console.log(
        `  ${c.name.padEnd(36)} ${kept} eps (${transcripts} transcripts)` +
          (collisions ? ` · ${collisions} dup-url skipped` : ""),
      );
    } catch (e: any) {
      console.log(`  ${c.name.padEnd(36)} FAIL: ${e.message}`);
    }
  }

  console.log(`\n${"─".repeat(56)}\nTotal: ${grandEps} episodes (${grandTx} inline transcripts).`);
  console.log("Run: npm run drain   to classify + score them.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
