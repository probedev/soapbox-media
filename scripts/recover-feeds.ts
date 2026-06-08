/**
 * Stale-feed recovery: for shows the expansion seeder dropped because PodScan's
 * top match was an abandoned/duplicate feed, search several query variants,
 * fetch the LATEST-episode date of every distinct candidate feed, and pin the
 * one that's actually live (newest episode < STALE_DAYS old) — picking by
 * recency, not by search rank. Same fix that recovered Maddow / Morning Joe.
 *
 * Dry-run by default (reports the live feed id + latest date per show, or "no
 * live feed found"); --apply pins the live feed, inserts the channel (per-entry
 * lean + cohort, auto-drafted rationale), and ingests 30 episodes inline.
 *
 * Run:  npx tsx scripts/recover-feeds.ts            (dry-run)
 *       npx tsx scripts/recover-feeds.ts --apply
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { searchPodcasts, getPodcastEpisodes, type PodscanPodcast } from "@/lib/podscan";
import { generateChannelRationale } from "@/lib/channels";

const MIN_DURATION_SEC = 180;
const STALE_DAYS = 60;
const RESULTS_PER_QUERY = 5;
const APPLY = process.argv.includes("--apply");

type Lean = "L" | "M" | "R";
type Cohort = "independent" | "legacy";
interface Show { name: string; lean: Lean; cohort: Cohort; queries: string[] }

const SHOWS: Show[] = [
  // legacy
  { name: "The Journal.", lean: "M", cohort: "legacy", queries: ["The Journal", "The Journal WSJ", "The Journal Wall Street Journal podcast"] },
  { name: "Post Reports", lean: "L", cohort: "legacy", queries: ["Post Reports", "Post Reports Washington Post"] },
  { name: "The Opinions", lean: "L", cohort: "legacy", queries: ["The Opinions New York Times", "The Opinions NYT", "NYT The Opinions"] },
  { name: "Interesting Times with Ross Douthat", lean: "R", cohort: "legacy", queries: ["Interesting Times Ross Douthat", "Ross Douthat", "Interesting Times NYT"] },
  { name: "Left, Right & Center", lean: "M", cohort: "legacy", queries: ["Left Right Center", "Left, Right & Center KCRW", "Left Right and Center"] },
  { name: "On the Media", lean: "L", cohort: "legacy", queries: ["On the Media WNYC", "On the Media Brooke Gladstone", "On the Media"] },
  // independent
  { name: "Lovett or Leave It", lean: "L", cohort: "independent", queries: ["Lovett or Leave It", "Lovett or Leave It Crooked", "Jon Lovett"] },
  { name: "Pod Save the People", lean: "L", cohort: "independent", queries: ["Pod Save the People", "Pod Save the People DeRay Mckesson"] },
  { name: "The Lincoln Project", lean: "L", cohort: "independent", queries: ["The Lincoln Project podcast", "The Lincoln Project"] },
  { name: "Politics War Room", lean: "L", cohort: "independent", queries: ["Politics War Room", "Politics War Room James Carville", "Carville Politics War Room"] },
  { name: "This Past Weekend w/ Theo Von", lean: "M", cohort: "independent", queries: ["This Past Weekend Theo Von", "Theo Von This Past Weekend"] },
  { name: "The Jordan B. Peterson Podcast", lean: "R", cohort: "independent", queries: ["The Jordan B Peterson Podcast", "Jordan B Peterson Podcast", "Jordan Peterson podcast"] },
  { name: "Armstrong & Getty", lean: "R", cohort: "independent", queries: ["Armstrong and Getty On Demand", "Armstrong and Getty", "Armstrong Getty"] },
  { name: "The Saad Truth with Dr. Gad Saad", lean: "R", cohort: "independent", queries: ["The Saad Truth with Dr Gad Saad", "Gad Saad", "The Saad Truth"] },
  { name: "The President's Daily Brief", lean: "R", cohort: "independent", queries: ["The President's Daily Brief", "President's Daily Brief Mike Baker"] },
  { name: "The World and Everything in It", lean: "R", cohort: "independent", queries: ["The World and Everything in It", "WORLD News Group", "World and Everything in It WORLD"] },
  { name: "Ruthless Podcast", lean: "R", cohort: "independent", queries: ["Ruthless Podcast", "Ruthless Variety Progressive", "Ruthless comedy conservative"] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function pickId(p: PodscanPodcast): string | null { return p.podcast_id || (p as any).id || (p as any).uuid || null; }
function pickTitle(p: PodscanPodcast): string { return p.podcast_name || (p as any).title || (p as any).name || "(untitled)"; }
function pickReach(p: PodscanPodcast): number {
  const c = [p.reach, (p as any).reach_estimate, (p as any).audience_size, (p as any).monthly_listeners];
  for (const x of c) { const n = typeof x === "string" ? parseInt(x, 10) : (x as number); if (Number.isFinite(n) && (n as number) > 0) return Math.round(n as number); }
  return 300_000;
}
function uniqueSourceUrl(ep: any): string | null {
  const audio = ep.episode_audio_url || ep.episode_audio_url_normalized || ep.audio_url;
  const link = ep.episode_url || ep.episode_permalink || ep.url;
  const guid = ep.episode_guid || ep.episode_id;
  if (audio) return String(audio);
  if (link && guid) return `${link}#${guid}`;
  return link || (guid ? `podscan:${guid}` : null);
}
function ageDays(iso?: string): number {
  if (!iso) return 99999;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor((Date.now() - ms) / 86_400_000) : 99999;
}

const STOP = new Set(["the", "a", "an", "and", "or", "with", "in", "it", "of", "to", "for", "show", "podcast", "pod", "daily", "w"]);
/**
 * The show's most distinctive word — longest non-stopword token, normalized.
 * The picked feed's title MUST contain it, so freshness alone can't pull in a
 * different-but-live show (WSJ Minute Briefing for "The Journal", Pod Save the
 * World for "Pod Save the People", etc.).
 */
function anchor(name: string): string {
  const toks = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));
  return toks.sort((a, b) => b.length - a.length)[0] || "";
}
function titleMatches(showName: string, title: string): boolean {
  const a = anchor(showName);
  if (!a) return true;
  return title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(a);
}

async function findLiveFeed(show: Show): Promise<{ id: string; title: string; reach: number; ageD: number } | null> {
  const seen = new Map<string, { title: string; reach: number; ageD: number }>();
  for (const q of show.queries) {
    let results: PodscanPodcast[] = [];
    try { results = await searchPodcasts(q); } catch { await sleep(500); continue; }
    for (const p of results.slice(0, RESULTS_PER_QUERY)) {
      const id = pickId(p);
      if (!id || seen.has(id)) continue;
      let ageD = 99999;
      try {
        const eps = (await getPodcastEpisodes(id, 1)) as any[];
        ageD = ageDays(eps[0]?.posted_at || eps[0]?.published_at);
      } catch { /* leave stale */ }
      seen.set(id, { title: pickTitle(p), reach: pickReach(p), ageD });
      await sleep(120);
    }
  }
  // best = freshest feed whose title actually matches the show (anchor guard)
  let best: { id: string; title: string; reach: number; ageD: number } | null = null;
  for (const [id, v] of seen) {
    if (!titleMatches(show.name, v.title)) continue;
    if (!best || v.ageD < best.ageD) best = { id, ...v };
  }
  return best && best.ageD <= STALE_DAYS ? best : best;
}

async function main() {
  const db = createServiceClient();
  const { data: existing } = await db.from("channels").select("name");
  const have = new Set((existing || []).map((c: any) => c.name.toLowerCase().replace(/[^a-z0-9]/g, "")));

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — feed recovery · ${SHOWS.length} shows · live = newest ep ≤${STALE_DAYS}d\n`);
  let recovered = 0, stillDead = 0;

  for (const show of SHOWS) {
    const tag = `  ${show.cohort[0].toUpperCase()} ${show.lean} ${show.name.slice(0, 34).padEnd(34)}`;
    if (have.has(show.name.toLowerCase().replace(/[^a-z0-9]/g, ""))) { console.log(`${tag} DUP already in panel`); continue; }
    const live = await findLiveFeed(show);
    if (!live || live.ageD > STALE_DAYS) {
      console.log(`${tag} ✗ no live feed (freshest ${live ? live.ageD + "d" : "none"})`);
      stillDead++;
      continue;
    }
    if (!APPLY) {
      console.log(`${tag} ✓ LIVE ${live.id} · last ${live.ageD}d · "${live.title.slice(0, 26)}"`);
      recovered++;
      continue;
    }
    // pin + ingest
    const eps = (await getPodcastEpisodes(live.id, 30).catch(() => [])) as any[];
    const rationale = await generateChannelRationale({ title: live.title, description: "", lean: show.lean, recentTitles: eps.slice(0, 8).map((e) => e.episode_title || e.title).filter(Boolean) });
    const { data: ins, error } = await db.from("channels").insert({
      name: show.name, platform: "podcast", platform_id: live.id, political_lean: show.lean,
      cohort: show.cohort, reach: live.reach, classification_rationale: rationale, active: true,
    }).select("id").single();
    if (error || !ins) { console.log(`${tag} FAIL ${error?.message}`); stillDead++; continue; }
    let kept = 0, tx = 0; const seenUrl = new Set<string>();
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
        const { error: te } = await db.from("transcripts").upsert({ episode_id: er[0].id, text: String(text), provider: "podscan" }, { onConflict: "episode_id", ignoreDuplicates: false });
        if (!te) { tx++; await db.from("episodes").update({ transcript_status: "fetched" }).eq("id", er[0].id); }
      }
    }
    recovered++;
    console.log(`${tag} ✓ RECOVERED ${live.id} · ${kept} eps (${tx} tx)`);
  }

  console.log(`\n${"─".repeat(64)}`);
  console.log(`${APPLY ? "Recovered" : "Recoverable"}: ${recovered} · still dead: ${stillDead}`);
  if (APPLY && recovered) console.log(`Then: npm run drain && npm run refresh:snapshot`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
