/**
 * One-off feed recovery for The Daily (NYT). Both prior channel rows pointed
 * at abandoned PodScan feeds (latest eps 2022) and were deactivated 2026-06-05;
 * this finds the LIVE feed and seeds one clean row.
 *
 * Differs from recover-feeds.ts in two ways: (1) the anchor-token guard is
 * useless here ("the" + "daily" are both stopwords), so candidates must have
 * the EXACT normalized title "thedaily"; (2) reach is pinned editorially at
 * 4M (matching the deactivated rows) instead of pickReach's 300k fallback.
 *
 * Dry-run by default; --apply inserts + ingests 30 episodes inline.
 *
 * Run:  npx tsx scripts/recover-the-daily.ts --apply
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { searchPodcasts, getPodcastEpisodes } from "@/lib/podscan";
import { generateChannelRationale } from "@/lib/channels";

const APPLY = process.argv.includes("--apply");
const NAME = "The Daily (NYT)";
const LEAN = "L" as const;
const COHORT = "legacy" as const;
const REACH = 4_000_000; // editorial — matches the deactivated rows
const STALE_DAYS = 60;
const MIN_DURATION_SEC = 180;
const QUERIES = ["The Daily", "The Daily New York Times", "The Daily NYT Michael Barbaro"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function ageDays(iso?: string): number {
  if (!iso) return 99999;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor((Date.now() - ms) / 86_400_000) : 99999;
}

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
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — recover "${NAME}" · exact-title match · live = ≤${STALE_DAYS}d\n`);

  // Collect candidate feeds titled exactly "The Daily", pick the freshest
  const seen = new Map<string, { title: string; ageD: number }>();
  for (const q of QUERIES) {
    let results: any[] = [];
    try { results = await searchPodcasts(q); } catch { await sleep(500); continue; }
    for (const p of results.slice(0, 8)) {
      const id = p.podcast_id || p.id || p.uuid;
      const title = p.podcast_name || p.title || p.name || "";
      if (!id || seen.has(id) || norm(title) !== "thedaily") continue;
      let ageD = 99999;
      try {
        const eps = (await getPodcastEpisodes(id, 1)) as any[];
        ageD = ageDays(eps[0]?.posted_at || eps[0]?.published_at);
      } catch { /* leave stale */ }
      seen.set(id, { title, ageD });
      console.log(`  candidate ${id} · "${title}" · latest ep ${ageD}d ago`);
      await sleep(120);
    }
  }

  let best: { id: string; ageD: number } | null = null;
  for (const [id, v] of seen) if (!best || v.ageD < best.ageD) best = { id, ageD: v.ageD };

  if (!best || best.ageD > STALE_DAYS) {
    console.log(`\n✗ no live feed found (freshest ${best ? best.ageD + "d" : "none"})`);
    process.exit(1);
  }
  console.log(`\n✓ LIVE feed: ${best.id} (latest ep ${best.ageD}d ago)`);
  if (!APPLY) { console.log("Dry run — re-run with --apply to insert + ingest."); return; }

  const eps = (await getPodcastEpisodes(best.id, 30).catch(() => [])) as any[];
  const rationale = await generateChannelRationale({
    title: NAME, description: "", lean: LEAN,
    recentTitles: eps.slice(0, 8).map((e) => e.episode_title || e.title).filter(Boolean),
  });
  const { data: ins, error } = await db.from("channels").insert({
    name: NAME, platform: "podcast", platform_id: best.id, political_lean: LEAN,
    cohort: COHORT, reach: REACH, classification_rationale: rationale, active: true,
  }).select("id").single();
  if (error || !ins) throw new Error(`insert failed: ${error?.message}`);

  let kept = 0, tx = 0;
  const seenUrl = new Set<string>();
  for (const ep of eps) {
    const url = uniqueSourceUrl(ep);
    const published = ep.posted_at || ep.published_at || ep.created_at;
    const duration = ep.episode_duration ?? ep.duration ?? 0;
    const text = ep.episode_transcript || ep.transcript || ep.text;
    if (!url || !published || Number(duration) < MIN_DURATION_SEC || seenUrl.has(url)) continue;
    seenUrl.add(url);
    const { data: er } = await db.from("episodes").upsert({
      channel_id: ins.id, title: String(ep.episode_title || ep.title || "(untitled)").slice(0, 500),
      published_at: published, source_url: url, duration_sec: Math.round(Number(duration)) || null,
    }, { onConflict: "channel_id,source_url", ignoreDuplicates: false }).select();
    if (!er?.[0]) continue;
    kept++;
    if (text && String(text).trim()) {
      const { error: te } = await db.from("transcripts").upsert(
        { episode_id: er[0].id, text: String(text), provider: "podscan" },
        { onConflict: "episode_id", ignoreDuplicates: false });
      if (!te) { tx++; await db.from("episodes").update({ transcript_status: "fetched" }).eq("id", er[0].id); }
    }
  }
  console.log(`✓ RECOVERED · channel ${ins.id} · ${kept} eps (${tx} with transcripts) · reach ${REACH.toLocaleString()} (editorial)`);
  console.log("Pipeline crons will classify/score on their normal cadence.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
