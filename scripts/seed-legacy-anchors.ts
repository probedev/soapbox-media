/**
 * Seed legacy-media ANCHOR podcasts (cohort = 'legacy').
 *
 * The existing 9 legacy rows are network YouTube feeds (Fox News, MS NOW, …).
 * This batch adds the podcasts fronted by on-air anchors who are *currently at*
 * a traditional network — MSNBC / Fox / CNN talent. Anyone who has LEFT their
 * network (Tucker, Megyn Kelly, Don Lemon, Mehdi Hasan) stays in `independent`;
 * that's the cohort line.
 *
 * Per the 2026-06-01 editorial call: "anchors only, honest imbalance" — we add
 * whoever has a real podcast feed and let L/R fall where it falls. Institutional
 * daily-news pods (NPR Politics, The Journal, Post Reports, Economist) are
 * deliberately deferred to a later "institutional" batch.
 *
 * SAFETY: dry-run by default — resolves each show via PodScan and prints the
 * top match + reach + recent-episode count so misresolved feeds get caught
 * before anything is written. Pass `--apply` to actually insert + ingest.
 *
 * Run:  npx tsx scripts/seed-legacy-anchors.ts            (dry run, no writes)
 *       npx tsx scripts/seed-legacy-anchors.ts --apply    (insert + ingest 30 eps)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import {
  searchPodcasts,
  getPodcastEpisodes,
  type PodscanPodcast,
} from "@/lib/podscan";

const MIN_DURATION_SEC = 180;
const APPLY = process.argv.includes("--apply");

/**
 * Anchor → network → lean. `query` overrides the PodScan search when the bare
 * name is ambiguous. The big collision to avoid: MSNBC's "All In with Chris
 * Hayes" vs the VC "All-In Podcast" we already track as independent — hence the
 * explicit, network-qualified query.
 */
const SEED: Array<{
  name: string;
  lean: "L" | "M" | "R";
  network: string;
  query?: string;
  rationale: string;
}> = [
  // ── MSNBC anchors (L) ──────────────────────────────────────────────────
  { name: "The Rachel Maddow Show", lean: "L", network: "MSNBC", query: "The Rachel Maddow Show MSNBC", rationale: "MSNBC primetime anchor; flagship L cable voice" },
  { name: "All In with Chris Hayes", lean: "L", network: "MSNBC", query: "All In with Chris Hayes", rationale: "MSNBC primetime anchor (distinct from the VC 'All-In Podcast')" },
  // The Last Word w/ Lawrence O'Donnell — dropped: no PodScan feed (2026-06-01).
  { name: "The Blueprint with Jen Psaki", lean: "L", network: "MSNBC", query: "The Blueprint Jen Psaki", rationale: "MSNBC host, ex-WH press sec; L" },
  { name: "Morning Joe", lean: "L", network: "MSNBC", query: "Morning Joe", rationale: "MSNBC morning flagship; center-L" },
  { name: "Deadline: White House", lean: "L", network: "MSNBC", query: "Deadline White House Nicolle Wallace", rationale: "MSNBC afternoon anchor Nicolle Wallace; L" },
  { name: "The Beat with Ari Melber", lean: "L", network: "MSNBC", query: "The Beat with Ari Melber", rationale: "MSNBC anchor; L" },

  // ── Fox News anchors (R, news anchors M) ───────────────────────────────
  { name: "The Will Cain Show", lean: "R", network: "Fox News", query: "The Will Cain Show", rationale: "Fox News host; R" },
  { name: "Brian Kilmeade Show", lean: "R", network: "Fox News", query: "Brian Kilmeade Show", rationale: "Fox & Friends / Fox News Radio host; R" },
  { name: "The Bret Baier Podcast", lean: "M", network: "Fox News", query: "Bret Baier Fox News", rationale: "Fox News chief anchor; straight-news posture → M" },
  { name: "The Five", lean: "R", network: "Fox News", query: "The Five", rationale: "Fox News flagship panel show; R" },
  { name: "Jesse Watters", lean: "R", network: "Fox News", query: "Jesse Watters Fox News", rationale: "Fox News primetime host; R" },
  { name: "The Trey Gowdy Podcast", lean: "R", network: "Fox News", query: "Trey Gowdy", rationale: "Fox News weekend host; R" },
  { name: "The Guy Benson Show", lean: "R", network: "Fox News", query: "The Guy Benson Show Fox", rationale: "Fox News Radio host; R" },
  { name: "The Fox News Rundown", lean: "M", network: "Fox News", query: "The Fox News Rundown", rationale: "Fox News daily news brief; straight-news → M" },

  // ── CNN anchors (M) ────────────────────────────────────────────────────
  { name: "The Axe Files", lean: "M", network: "CNN", query: "The Axe Files David Axelrod", rationale: "CNN/Univ. of Chicago; ex-Obama strategist, cross-cutting interviews → M" },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Per-episode-unique source_url for the (channel_id, source_url) upsert key.
 * Network feeds (MS NOW / NBC News) put a show-level URL (https://www.ms.now/)
 * on EVERY episode, which collapses all of them onto one row. So prefer the
 * per-episode audio enclosure; otherwise disambiguate the link with the GUID.
 */
function uniqueSourceUrl(ep: any): string | null {
  const audio = ep.episode_audio_url || ep.episode_audio_url_normalized || ep.audio_url;
  const link = ep.episode_url || ep.episode_permalink || ep.url;
  const guid = ep.episode_guid || ep.episode_id;
  if (audio) return String(audio);
  if (link && guid) return `${link}#${guid}`;
  return link || (guid ? `podscan:${guid}` : null);
}
function pickId(p: PodscanPodcast): string | null {
  return p.podcast_id || (p as any).id || (p as any).uuid || (p as any).pscid || (p as any).slug || null;
}
function pickTitle(p: PodscanPodcast): string {
  return p.podcast_name || (p as any).title || (p as any).name || "(untitled)";
}
function pickReach(p: PodscanPodcast): number {
  const candidates = [
    p.reach,
    (p as any).reach_estimate,
    (p as any).audience_size,
    (p as any).monthly_listeners,
    (p as any).audience,
    (p as any).estimated_audience,
  ];
  for (const c of candidates) {
    const n = typeof c === "string" ? parseInt(c, 10) : (c as number);
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 300_000; // editorial floor — every entry here is a national network show
}

async function main() {
  const db = createServiceClient();
  const { data: existing } = await db.from("channels").select("name");
  const haveNormalized = new Set(
    (existing || []).map((c: { name: string }) => normalize(c.name)),
  );

  console.log(
    `\n${APPLY ? "APPLYING" : "DRY RUN"} — legacy anchor podcasts (cohort=legacy). ` +
      `${SEED.length} candidates · existing panel: ${(existing || []).length} rows.\n`,
  );
  if (!APPLY) {
    console.log("No writes. Review the matches below, then re-run with --apply.\n");
  }

  let added = 0, skipped = 0, failed = 0, totalEpisodes = 0, totalTranscripts = 0;

  for (const entry of SEED) {
    const prefix = `  ${entry.network.padEnd(6)} ${entry.lean} ${entry.name.slice(0, 38).padEnd(38)}`;
    if (haveNormalized.has(normalize(entry.name))) {
      console.log(`${prefix} [SKIP] already in panel`);
      skipped++;
      continue;
    }
    try {
      const results = await searchPodcasts(entry.query || entry.name);
      if (results.length === 0) {
        console.log(`${prefix} [MISS] no PodScan match for "${entry.query || entry.name}"`);
        failed++;
        continue;
      }
      const top = results[0];
      const id = pickId(top);
      const matchedTitle = pickTitle(top);
      const reach = pickReach(top);
      if (!id) {
        console.log(`${prefix} [MISS] top match "${matchedTitle}" has no id`);
        failed++;
        continue;
      }

      if (!APPLY) {
        // Show the runner-up too so a wrong top-match is obvious.
        const alt = results[1] ? ` | #2: ${pickTitle(results[1]).slice(0, 30)}` : "";
        console.log(
          `${prefix} → "${matchedTitle.slice(0, 34).padEnd(34)}" reach ${reach.toLocaleString().padStart(10)}${alt}`,
        );
        continue;
      }

      // ── APPLY: insert + deep-ingest 30 episodes ──────────────────────────
      const { data: insRow, error: insErr } = await db
        .from("channels")
        .insert({
          name: entry.name,
          platform: "podcast",
          platform_id: id,
          political_lean: entry.lean,
          reach,
          active: true,
          cohort: "legacy",
          classification_rationale: `${entry.network} — ${entry.rationale}`,
        })
        .select("id")
        .single();
      if (insErr || !insRow) {
        console.log(`${prefix} [FAIL] insert: ${insErr?.message}`);
        failed++;
        continue;
      }

      const eps = await getPodcastEpisodes(id, 30).catch((e) => {
        console.log(`${prefix}   episodes fetch failed: ${e.message}`);
        return [];
      });
      let kept = 0, transcripts = 0;
      for (const ep of eps) {
        const url = uniqueSourceUrl(ep);
        const title = ep.episode_title || (ep as any).title || (ep as any).name || "(untitled)";
        const published = (ep as any).posted_at || (ep as any).published_at || (ep as any).created_at;
        const duration = ep.episode_duration ?? (ep as any).duration ?? (ep as any).duration_seconds ?? 0;
        const transcriptText = ep.episode_transcript || (ep as any).transcript || (ep as any).text;
        if (!url || !published) continue;
        if (Number(duration) < MIN_DURATION_SEC) continue;
        const { data: epData, error: epErr } = await db
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
        `${prefix} [ OK ] → "${matchedTitle.slice(0, 30)}" · reach ${reach.toLocaleString()} · ${kept} eps (${transcripts} transcripts)`,
      );
    } catch (e: any) {
      console.log(`${prefix} [FAIL] ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(64)}`);
  if (APPLY) {
    console.log(`Added: ${added} · skipped: ${skipped} · failed: ${failed}`);
    console.log(`Episodes ingested: ${totalEpisodes} (${totalTranscripts} inline transcripts)`);
    console.log(`Classify + score will catch them up (run: npm run drain).`);
  } else {
    console.log(`Resolved cleanly: ${SEED.length - skipped - failed} · skipped: ${skipped} · misses: ${failed}`);
    console.log(`Re-run with --apply once the matches look right.`);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
