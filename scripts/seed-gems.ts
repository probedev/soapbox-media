/**
 * Seed the 2026-06-01 "CSV gems" batch — independent-cohort podcasts curated
 * from a beta tester's list, chosen to fill panel gaps (especially the thin
 * Middle) and lanes we had nothing in (anti-Trump conservatives).
 *
 * All cohort='independent'. Dry-run by default (resolve + print matches/reach +
 * runner-up so misresolved feeds get caught); pass --apply to insert + ingest.
 *
 * Run:  npx tsx scripts/seed-gems.ts            (dry run)
 *       npx tsx scripts/seed-gems.ts --apply    (insert + ingest 30 eps)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { searchPodcasts, getPodcastEpisodes, type PodscanPodcast } from "@/lib/podscan";

const MIN_DURATION_SEC = 180;
const APPLY = process.argv.includes("--apply");

const SEED: Array<{ name: string; lean: "L" | "M" | "R"; bucket: string; query?: string; rationale: string }> = [
  // ── Middle / cross-cutting ─────────────────────────────────────────────
  { name: "Tangle", lean: "M", bucket: "Middle", query: "Tangle", rationale: "Explicitly nonpartisan daily politics newsletter/podcast" },
  { name: "The Rest Is Politics: US", lean: "M", bucket: "Middle", query: "The Rest Is Politics US", rationale: "Centrist transatlantic politics; large audience" },
  { name: "Open To Debate", lean: "M", bucket: "Middle", query: "Open to Debate", rationale: "Formal Oxford-style debate; structurally balanced" },
  { name: "Hacks on Tap", lean: "M", bucket: "Middle", query: "Hacks on Tap Axelrod Murphy", rationale: "Axelrod (D) + Murphy (R) bipartisan strategist talk" },
  { name: "The Chuck ToddCast", lean: "M", bucket: "Middle", query: "Chuck ToddCast", rationale: "Ex-NBC; straight-down-the-middle political analysis" },
  { name: "Plain English with Derek Thompson", lean: "M", bucket: "Middle", query: "Plain English Derek Thompson", rationale: "Atlantic-style data/wonk; cross-cutting" },

  // ── Anti-Trump / heterodox conservatives ───────────────────────────────
  { name: "The Dispatch Podcast", lean: "R", bucket: "Anti-Trump R", query: "The Dispatch Podcast", rationale: "Center-right, anti-Trump conservative" },
  { name: "The Remnant with Jonah Goldberg", lean: "R", bucket: "Anti-Trump R", query: "The Remnant Jonah Goldberg", rationale: "Conservative, anti-populist; intellectual R" },
  { name: "The Focus Group", lean: "M", bucket: "Anti-Trump R", query: "The Focus Group Sarah Longwell", rationale: "Bulwark voter focus groups; anti-Trump center" },
  { name: "The David Frum Show", lean: "M", bucket: "Anti-Trump R", query: "The David Frum Show", rationale: "Anti-Trump conservative (Atlantic); center posture" },

  // ── More Right voices ──────────────────────────────────────────────────
  { name: "The Victor Davis Hanson Show", lean: "R", bucket: "Right", query: "Victor Davis Hanson", rationale: "Intellectual conservative; historian" },
  { name: "The Liz Wheeler Show", lean: "R", bucket: "Right", query: "Liz Wheeler", rationale: "Populist-right commentary" },
  { name: "Relatable with Allie Beth Stuckey", lean: "R", bucket: "Right", query: "Allie Beth Stuckey Relatable", rationale: "Christian-conservative cultural commentary (BlazeTV)" },
  { name: "Part Of The Problem", lean: "R", bucket: "Right", query: "Part of the Problem Dave Smith", rationale: "Libertarian/anti-war; Dave Smith" },
  { name: "The Benny Show", lean: "R", bucket: "Right", query: "The Benny Show Benny Johnson", rationale: "MAGA digital-right" },

  // ── More Left voices ───────────────────────────────────────────────────
  { name: "Offline with Jon Favreau", lean: "L", bucket: "Left", query: "Offline Jon Favreau", rationale: "Crooked Media; tech+politics, distinct from Pod Save" },
  { name: "Pod Save the World", lean: "L", bucket: "Left", query: "Pod Save the World", rationale: "Crooked Media foreign policy" },
  { name: "Stay Tuned with Preet", lean: "L", bucket: "Left", query: "Stay Tuned with Preet Bharara", rationale: "Preet Bharara; legal/measured center-left" },
  { name: "Useful Idiots", lean: "L", bucket: "Left", query: "Useful Idiots Katie Halper", rationale: "Left-heterodox media criticism" },
  { name: "Bad Faith", lean: "L", bucket: "Left", query: "Bad Faith Briahna Joy Gray", rationale: "Left-populist" },
];

function normalize(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function pickId(p: PodscanPodcast): string | null {
  return p.podcast_id || (p as any).id || (p as any).uuid || (p as any).pscid || (p as any).slug || null;
}
function pickTitle(p: PodscanPodcast): string {
  return p.podcast_name || (p as any).title || (p as any).name || "(untitled)";
}
function pickReach(p: PodscanPodcast): number {
  const c = [p.reach, (p as any).reach_estimate, (p as any).audience_size, (p as any).monthly_listeners, (p as any).audience, (p as any).estimated_audience];
  for (const x of c) { const n = typeof x === "string" ? parseInt(x, 10) : (x as number); if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.round(n); }
  return 300_000;
}
/** Per-episode-unique source_url (handles feeds with a show-level URL on every item). */
function uniqueSourceUrl(ep: any): string | null {
  const audio = ep.episode_audio_url || ep.episode_audio_url_normalized || ep.audio_url;
  const link = ep.episode_url || ep.episode_permalink || ep.url;
  const guid = ep.episode_guid || ep.episode_id;
  if (audio) return String(audio);
  if (link && guid) return `${link}#${guid}`;
  return link || (guid ? `podscan:${guid}` : null);
}

async function main() {
  const db = createServiceClient();
  const { data: existing } = await db.from("channels").select("name");
  const have = new Set((existing || []).map((c: { name: string }) => normalize(c.name)));

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — CSV gems (cohort=independent). ${SEED.length} candidates.\n`);
  let added = 0, skipped = 0, failed = 0, totalEps = 0, totalTx = 0;

  for (const e of SEED) {
    const prefix = `  ${e.bucket.padEnd(12)} ${e.lean} ${e.name.slice(0, 36).padEnd(36)}`;
    if (have.has(normalize(e.name))) { console.log(`${prefix} [SKIP] already in panel`); skipped++; continue; }
    try {
      const results = await searchPodcasts(e.query || e.name);
      const top = results[0];
      if (!top) { console.log(`${prefix} [MISS] no match for "${e.query || e.name}"`); failed++; continue; }
      const id = pickId(top), title = pickTitle(top), reach = pickReach(top);
      if (!id) { console.log(`${prefix} [MISS] "${title}" has no id`); failed++; continue; }

      if (!APPLY) {
        const alt = results[1] ? ` | #2: ${pickTitle(results[1]).slice(0, 26)}` : "";
        console.log(`${prefix} → "${title.slice(0, 30).padEnd(30)}" reach ${reach.toLocaleString().padStart(9)}${alt}`);
        continue;
      }

      const { data: ins, error: insErr } = await db.from("channels").insert({
        name: e.name, platform: "podcast", platform_id: id, political_lean: e.lean,
        reach, active: true, cohort: "independent", classification_rationale: e.rationale,
      }).select("id").single();
      if (insErr || !ins) { console.log(`${prefix} [FAIL] ${insErr?.message}`); failed++; continue; }

      const eps = (await getPodcastEpisodes(id, 30).catch(() => [])) as any[];
      let kept = 0, tx = 0; const seen = new Set<string>();
      for (const ep of eps) {
        const url = uniqueSourceUrl(ep);
        const published = ep.posted_at || ep.published_at || ep.created_at;
        const duration = ep.episode_duration ?? ep.duration ?? 0;
        const text = ep.episode_transcript || ep.transcript || ep.text;
        if (!url || !published || Number(duration) < MIN_DURATION_SEC || seen.has(url)) continue;
        seen.add(url);
        const { data: epRow, error: epErr } = await db.from("episodes").upsert({
          channel_id: ins.id, title: String(ep.episode_title || ep.title || "(untitled)").slice(0, 500),
          published_at: published, source_url: url,
          duration_sec: typeof duration === "number" ? Math.round(duration) : null,
        }, { onConflict: "channel_id,source_url", ignoreDuplicates: false }).select();
        if (epErr || !epRow?.[0]) continue;
        kept++;
        if (text && String(text).trim().length > 0) {
          const { error: txErr } = await db.from("transcripts").upsert(
            { episode_id: epRow[0].id, text: String(text), provider: "podscan" },
            { onConflict: "episode_id", ignoreDuplicates: false });
          if (!txErr) { tx++; await db.from("episodes").update({ transcript_status: "fetched" }).eq("id", epRow[0].id); }
        }
      }
      added++; totalEps += kept; totalTx += tx;
      console.log(`${prefix} [ OK ] → "${title.slice(0, 26)}" · ${kept} eps (${tx} tx)`);
    } catch (err: any) { console.log(`${prefix} [FAIL] ${err.message}`); failed++; }
  }

  console.log(`\n${"─".repeat(64)}`);
  console.log(APPLY
    ? `Added: ${added} · skipped: ${skipped} · failed: ${failed} · ${totalEps} eps (${totalTx} transcripts). Run: npm run drain`
    : `Resolved: ${SEED.length - skipped - failed} · skipped: ${skipped} · misses: ${failed}. Re-run with --apply.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
