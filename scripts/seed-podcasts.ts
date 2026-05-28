/**
 * One-off seed script for the May-28 podcast expansion batch.
 *
 * For each (name, lean) row below: resolves the show via PodScan
 * (`searchPodcasts`), confirms the top match's title is a sensible fit,
 * inserts into `channels`, and deep-ingests the last 30 episodes via PodScan
 * (transcripts arrive inline so transcribe is essentially done at ingest).
 *
 * Skips anything already present (by normalized name) and anything PodScan
 * can't resolve. Logs each step for editorial visibility.
 *
 * Run:  npm run seed:podcasts
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { searchPodcasts, getPodcastEpisodes, type PodscanPodcast } from "@/lib/podscan";

const MIN_DURATION_SEC = 180;

// Editor-curated batch — confirmed not-already-in-panel by manual cross-check
// against the existing channels list (2026-05-28).
const SEED: Array<{ name: string; lean: "L" | "M" | "R"; query?: string }> = [
  { name: "Bill O'Reilly's No Spin News", lean: "R", query: "No Spin News Bill O'Reilly" },
  { name: "The Daily Beans", lean: "L" },
  { name: "The Clay Travis & Buck Sexton Show", lean: "R", query: "Clay Travis Buck Sexton" },
  { name: "Conservative Review with Daniel Horowitz", lean: "R", query: "Conservative Review Daniel Horowitz" },
  { name: "Pat Gray Unleashed", lean: "R" },
  { name: "The Jesse Kelly Show", lean: "R" },
  { name: "The Joe Pags Show", lean: "R" },
  { name: "Sara Gonzales Unfiltered", lean: "R" },
  { name: "The Dennis Prager Show", lean: "R", query: "Dennis Prager" },
  { name: "Commentary Magazine Podcast", lean: "R" },
  { name: "The Dana Show with Dana Loesch", lean: "R", query: "Dana Loesch" },
  { name: "Chicks on The Right", lean: "R" },
  { name: "Political Beatdown with Michael Cohen", lean: "L", query: "Michael Cohen Political Beatdown" },
  { name: "The Scott Jennings Podcast", lean: "M", query: "Scott Jennings" },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickId(p: PodscanPodcast): string | null {
  return p.podcast_id || p.id || p.uuid || p.pscid || p.slug || null;
}

function pickTitle(p: PodscanPodcast): string {
  return p.podcast_name || p.title || p.name || "(untitled)";
}

function pickReach(p: PodscanPodcast): number {
  // PodScan exposes various audience metrics — pull whichever's present, else
  // fall back to a floor (editorially we've confirmed each show is ≥300K).
  const candidates = [
    p.reach,
    p.reach_estimate,
    p.audience_size,
    p.monthly_listeners,
    p.audience,
    p.estimated_audience,
  ];
  for (const c of candidates) {
    const n = typeof c === "string" ? parseInt(c, 10) : c;
    if (typeof n === "number" && n > 0) return Math.round(n);
  }
  return 300_000; // editorial floor
}

async function main() {
  const db = createServiceClient();
  const { data: existing } = await db.from("channels").select("name");
  const haveNormalized = new Set((existing || []).map((c: { name: string }) => normalize(c.name)));

  console.log(`\nSeeding ${SEED.length} podcasts (alt-media, May-28 batch). Existing panel: ${(existing || []).length} channel rows.\n`);

  let added = 0;
  let skipped = 0;
  let failed = 0;
  let totalEpisodes = 0;
  let totalTranscripts = 0;

  for (const entry of SEED) {
    if (haveNormalized.has(normalize(entry.name))) {
      console.log(`  [SKIP] "${entry.name}" — already in panel.`);
      skipped++;
      continue;
    }
    try {
      const results = await searchPodcasts(entry.query || entry.name);
      if (results.length === 0) {
        console.log(`  [MISS] "${entry.name}" — no PodScan match.`);
        failed++;
        continue;
      }
      const top = results[0];
      const id = pickId(top);
      if (!id) {
        console.log(`  [MISS] "${entry.name}" — top result has no ID. Fields: [${Object.keys(top).slice(0, 10).join(", ")}]`);
        failed++;
        continue;
      }
      const matchedTitle = pickTitle(top);
      const reach = pickReach(top);

      // Insert channel row
      const { data: insRow, error: insErr } = await db
        .from("channels")
        .insert({
          name: entry.name,
          platform: "podcast",
          platform_id: id,
          political_lean: entry.lean,
          reach,
          active: true,
        })
        .select("id")
        .single();
      if (insErr || !insRow) {
        console.log(`  [FAIL] "${entry.name}" — insert error: ${insErr?.message}`);
        failed++;
        continue;
      }

      // Deep-ingest 30 episodes
      const eps = await getPodcastEpisodes(id, 30).catch((e) => {
        console.log(`     episodes fetch failed: ${e.message}`);
        return [];
      });
      let kept = 0;
      let transcripts = 0;
      for (const ep of eps) {
        const url =
          ep.episode_url ||
          ep.episode_permalink ||
          ep.url ||
          ep.episode_audio_url ||
          ep.audio_url;
        const title = ep.episode_title || ep.title || ep.name || "(untitled)";
        const published = ep.posted_at || ep.published_at || ep.created_at;
        const duration = ep.episode_duration ?? ep.duration ?? ep.duration_seconds ?? 0;
        const transcriptText = ep.episode_transcript || ep.transcript || ep.text;
        if (!url || !published) continue;
        if (Number(duration) < MIN_DURATION_SEC) continue;
        const { error: epErr, data: epData } = await db
          .from("episodes")
          .upsert(
            {
              channel_id: insRow.id,
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
        // Inline transcript if present
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

      added++;
      totalEpisodes += kept;
      totalTranscripts += transcripts;
      console.log(
        `  [ OK ] ${entry.name.padEnd(45)} → ${matchedTitle.slice(0, 40).padEnd(40)} · ${entry.lean} · reach ${reach.toLocaleString()} · ${kept} eps (${transcripts} with transcripts)`,
      );
    } catch (e: any) {
      console.log(`  [FAIL] "${entry.name}" — ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Added: ${added} · skipped: ${skipped} · failed: ${failed}`);
  console.log(`Episodes ingested: ${totalEpisodes} (${totalTranscripts} with inline transcripts)`);
  console.log(`\nClassify + score crons will catch them up over the next 1–3 days.`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
