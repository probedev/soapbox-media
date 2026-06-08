/**
 * Batch channel-expansion seeder toward 200 (2026-06-03). Candidates from
 * docs/expansion-candidates-200.md. Handles BOTH YouTube networks and podcasts,
 * with per-entry lean + cohort.
 *
 * SAFETY: dry-run by default. For every candidate it resolves the feed, checks
 * reach (≥300K floor), **latest-content date (active check — drop feeds whose
 * newest item is >STALE_DAYS old; this is the MS NOW / Victor-Davis-Hanson
 * lesson)**, and dedups against the live panel by name + (YT) platform_id.
 * Prints a flagged table. Only with --apply does it write — and it only writes
 * rows flagged OK.
 *
 * YouTube rows are inserted channel-only here; run the per-day-capped backfill
 * afterward on the printed ids:
 *   npm run backfill:channel-history -- 3 30 <id1,id2,...>
 * Podcast rows are inserted + 30 episodes ingested inline (transcripts included).
 * Descriptions for both are auto-drafted (generateChannelRationale).
 *
 * Run:  npx tsx scripts/seed-expansion.ts                 (dry-run, all)
 *       npx tsx scripts/seed-expansion.ts --tranche=A      (dry-run, tranche A)
 *       npx tsx scripts/seed-expansion.ts --tranche=A --apply
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { resolveChannelByHandle, getRecentUploads } from "@/lib/youtube";
import { searchPodcasts, getPodcastEpisodes, type PodscanPodcast } from "@/lib/podscan";
import { generateChannelRationale } from "@/lib/channels";

const MIN_DURATION_SEC = 180;
const SUB_FLOOR = 300_000;
const STALE_DAYS = 60;
const APPLY = process.argv.includes("--apply");
const TRANCHE = (process.argv.find((a) => a.startsWith("--tranche=")) || "").split("=")[1] || "all";

type Lean = "L" | "M" | "R";
type Cohort = "independent" | "legacy";
interface Cand {
  tranche: "A" | "B";
  kind: "youtube" | "podcast";
  name: string;
  lean: Lean;
  cohort: Cohort;
  handle?: string;
  query?: string;
}

const CANDIDATES: Cand[] = [
  // ── Tranche A: legacy network YouTube channels ─────────────────────────
  { tranche: "A", kind: "youtube", name: "Fox Business", lean: "R", cohort: "legacy", handle: "@foxbusiness" },
  { tranche: "A", kind: "youtube", name: "CNBC Television", lean: "M", cohort: "legacy", handle: "@cnbctelevision" },
  { tranche: "A", kind: "youtube", name: "Bloomberg Television", lean: "M", cohort: "legacy", handle: "@markets" },
  { tranche: "A", kind: "youtube", name: "NewsNation", lean: "M", cohort: "legacy", handle: "@newsnation" },
  { tranche: "A", kind: "youtube", name: "New York Post", lean: "R", cohort: "legacy", handle: "@nypost" },
  { tranche: "A", kind: "youtube", name: "VICE News", lean: "L", cohort: "legacy", handle: "@vicenews" },
  { tranche: "A", kind: "youtube", name: "Politico", lean: "M", cohort: "legacy", handle: "@politico" },
  { tranche: "A", kind: "youtube", name: "Associated Press", lean: "M", cohort: "legacy", handle: "@AP" },
  { tranche: "A", kind: "youtube", name: "Reuters", lean: "M", cohort: "legacy", handle: "@reuters" },
  { tranche: "A", kind: "youtube", name: "BBC News", lean: "M", cohort: "legacy", handle: "@bbcnews" },
  { tranche: "A", kind: "youtube", name: "Al Jazeera English", lean: "M", cohort: "legacy", handle: "@aljazeeraenglish" },
  { tranche: "A", kind: "youtube", name: "DW News", lean: "M", cohort: "legacy", handle: "@dwnews" },
  // ── Tranche A: legacy institutional podcasts ───────────────────────────
  { tranche: "A", kind: "podcast", name: "The NPR Politics Podcast", lean: "M", cohort: "legacy", query: "NPR Politics Podcast" },
  { tranche: "A", kind: "podcast", name: "Up First from NPR", lean: "M", cohort: "legacy", query: "Up First NPR" },
  { tranche: "A", kind: "podcast", name: "Consider This from NPR", lean: "M", cohort: "legacy", query: "Consider This from NPR" },
  { tranche: "A", kind: "podcast", name: "The Journal.", lean: "M", cohort: "legacy", query: "The Journal Wall Street Journal" },
  { tranche: "A", kind: "podcast", name: "Post Reports", lean: "L", cohort: "legacy", query: "Post Reports Washington Post" },
  { tranche: "A", kind: "podcast", name: "Radio Atlantic", lean: "L", cohort: "legacy", query: "Radio Atlantic The Atlantic" },
  { tranche: "A", kind: "podcast", name: "Economist Podcasts", lean: "M", cohort: "legacy", query: "Economist Podcasts" },
  { tranche: "A", kind: "podcast", name: "Today, Explained", lean: "L", cohort: "legacy", query: "Today Explained Vox" },
  { tranche: "A", kind: "podcast", name: "Political Gabfest", lean: "L", cohort: "legacy", query: "Political Gabfest Slate" },
  { tranche: "A", kind: "podcast", name: "Left, Right & Center", lean: "M", cohort: "legacy", query: "Left Right and Center KCRW" },
  { tranche: "A", kind: "podcast", name: "On the Media", lean: "L", cohort: "legacy", query: "On the Media WNYC" },
  { tranche: "A", kind: "podcast", name: "The Opinions", lean: "L", cohort: "legacy", query: "The Opinions New York Times" },
  { tranche: "A", kind: "podcast", name: "Interesting Times with Ross Douthat", lean: "R", cohort: "legacy", query: "Interesting Times Ross Douthat" },

  // ── Tranche B: independent gems (podcasts) ─────────────────────────────
  { tranche: "B", kind: "podcast", name: "Lovett or Leave It", lean: "L", cohort: "independent", query: "Lovett or Leave It" },
  { tranche: "B", kind: "podcast", name: "What A Day", lean: "L", cohort: "independent", query: "What A Day Crooked" },
  { tranche: "B", kind: "podcast", name: "Pod Save the People", lean: "L", cohort: "independent", query: "Pod Save the People" },
  { tranche: "B", kind: "podcast", name: "The Warning with Steve Schmidt", lean: "L", cohort: "independent", query: "The Warning Steve Schmidt" },
  { tranche: "B", kind: "podcast", name: "Fast Politics", lean: "L", cohort: "independent", query: "Fast Politics Molly Jong-Fast" },
  { tranche: "B", kind: "podcast", name: "The Lincoln Project", lean: "L", cohort: "independent", query: "The Lincoln Project podcast" },
  { tranche: "B", kind: "podcast", name: "Politics War Room", lean: "L", cohort: "independent", query: "Politics War Room James Carville" },
  { tranche: "B", kind: "podcast", name: "Next Level", lean: "M", cohort: "independent", query: "Next Level Bulwark" },
  { tranche: "B", kind: "podcast", name: "Hell and High Water", lean: "L", cohort: "independent", query: "Hell and High Water Heilemann" },
  { tranche: "B", kind: "podcast", name: "On with Kara Swisher", lean: "M", cohort: "independent", query: "On with Kara Swisher" },
  { tranche: "B", kind: "podcast", name: "This Past Weekend w/ Theo Von", lean: "M", cohort: "independent", query: "This Past Weekend Theo Von" },
  { tranche: "B", kind: "podcast", name: "The Peter Zeihan Podcast", lean: "M", cohort: "independent", query: "Peter Zeihan" },
  { tranche: "B", kind: "podcast", name: "Next Up with Mark Halperin", lean: "M", cohort: "independent", query: "Next Up Mark Halperin" },
  { tranche: "B", kind: "podcast", name: "The Jordan B. Peterson Podcast", lean: "R", cohort: "independent", query: "Jordan B Peterson Podcast" },
  { tranche: "B", kind: "podcast", name: "Ruthless Podcast", lean: "R", cohort: "independent", query: "Ruthless Variety Progressive" },
  { tranche: "B", kind: "podcast", name: "Armstrong & Getty", lean: "R", cohort: "independent", query: "Armstrong and Getty" },
  { tranche: "B", kind: "podcast", name: "Steve Deace Show", lean: "R", cohort: "independent", query: "Steve Deace Show" },
  { tranche: "B", kind: "podcast", name: "The Trish Regan Show", lean: "R", cohort: "independent", query: "Trish Regan" },
  { tranche: "B", kind: "podcast", name: "John Solomon Reports", lean: "R", cohort: "independent", query: "John Solomon Reports" },
  { tranche: "B", kind: "podcast", name: "Pod Force One", lean: "R", cohort: "independent", query: "Pod Force One Miranda Devine" },
  { tranche: "B", kind: "podcast", name: "The Saad Truth with Dr. Gad Saad", lean: "R", cohort: "independent", query: "The Saad Truth Gad Saad" },
  { tranche: "B", kind: "podcast", name: "The President's Daily Brief", lean: "R", cohort: "independent", query: "The President's Daily Brief" },
  { tranche: "B", kind: "podcast", name: "The Wright Report", lean: "R", cohort: "independent", query: "The Wright Report Bryan Dean Wright" },
  { tranche: "B", kind: "podcast", name: "The World and Everything in It", lean: "R", cohort: "independent", query: "The World and Everything in It WORLD" },
  { tranche: "B", kind: "podcast", name: "Piers Morgan Uncensored", lean: "M", cohort: "independent", query: "Piers Morgan Uncensored" },
  // ── Tranche B: independent gems (YouTube — from discovery) ─────────────
  { tranche: "B", kind: "youtube", name: "The Free Press", lean: "M", cohort: "independent", handle: "@thefp" },
  { tranche: "B", kind: "youtube", name: "The Comments Section with Brett Cooper", lean: "R", cohort: "independent", handle: "@BrettCooperOfficial" },
  { tranche: "B", kind: "youtube", name: "Jason Whitlock", lean: "R", cohort: "independent", handle: "@JasonWhitlock" },
  { tranche: "B", kind: "youtube", name: "Sidebar with Viva Frei", lean: "R", cohort: "independent", handle: "@VivaFrei" },
  { tranche: "B", kind: "youtube", name: "Prime Time with Alex Stein", lean: "R", cohort: "independent", handle: "@PrimeTimeWithAlexStein" },
];

function normalize(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function pickId(p: PodscanPodcast): string | null {
  return p.podcast_id || (p as any).id || (p as any).uuid || null;
}
function pickTitle(p: PodscanPodcast): string {
  return p.podcast_name || (p as any).title || (p as any).name || "(untitled)";
}
function pickReach(p: PodscanPodcast): number {
  const c = [p.reach, (p as any).reach_estimate, (p as any).audience_size, (p as any).monthly_listeners, (p as any).audience];
  for (const x of c) { const n = typeof x === "string" ? parseInt(x, 10) : (x as number); if (Number.isFinite(n) && n > 0) return Math.round(n as number); }
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
function daysAgo(iso?: string): number {
  if (!iso) return 99999;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 99999;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

async function main() {
  const db = createServiceClient();
  const { data: existing } = await db.from("channels").select("name, platform, platform_id, active");
  const haveName = new Set((existing || []).map((c: any) => normalize(c.name)));
  const haveYtId = new Set((existing || []).filter((c: any) => c.platform === "youtube").map((c: any) => c.platform_id));

  const pool = CANDIDATES.filter((c) => TRANCHE === "all" || c.tranche === TRANCHE);
  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — expansion tranche=${TRANCHE} · ${pool.length} candidates · stale>${STALE_DAYS}d · floor ${SUB_FLOOR.toLocaleString()}\n`);

  const ytToBackfill: string[] = [];
  let added = 0, dropped = 0;

  for (const c of pool) {
    const tag = `  ${c.tranche} ${c.kind === "youtube" ? "YT " : "Pod"} ${c.lean} ${c.cohort[0].toUpperCase()} ${c.name.slice(0, 34).padEnd(34)}`;
    if (haveName.has(normalize(c.name))) { console.log(`${tag} DUP  already in panel`); dropped++; continue; }
    try {
      if (c.kind === "youtube") {
        const yt = await resolveChannelByHandle(c.handle!);
        if (!yt) { console.log(`${tag} ✗    no channel for ${c.handle}`); dropped++; continue; }
        if (haveYtId.has(yt.id)) { console.log(`${tag} DUP  platform_id already tracked (${yt.title})`); dropped++; continue; }
        const recent = await getRecentUploads(yt.uploadsPlaylistId, 1).catch(() => []);
        const ageD = daysAgo(recent[0]?.publishedAt);
        const flags = [yt.subscriberCount < SUB_FLOOR ? "LOWREACH" : "", ageD > STALE_DAYS ? `STALE(${ageD}d)` : ""].filter(Boolean);
        if (!APPLY) { console.log(`${tag} ${yt.subscriberCount.toLocaleString().padStart(11)} subs · last ${ageD}d ago${flags.length ? "  ⚠ " + flags.join(",") : "  OK"} · ${yt.title.slice(0, 22)}`); continue; }
        if (flags.length) { console.log(`${tag} SKIP ${flags.join(",")}`); dropped++; continue; }
        const rationale = await generateChannelRationale({ title: yt.title, description: yt.description, lean: c.lean, recentTitles: recent.map((r) => r.title) });
        const { data: ins, error } = await db.from("channels").insert({
          name: c.name, platform: "youtube", platform_id: yt.id, political_lean: c.lean,
          cohort: c.cohort, reach: yt.subscriberCount, classification_rationale: rationale, active: true,
        }).select("id").single();
        if (error || !ins) { console.log(`${tag} FAIL ${error?.message}`); dropped++; continue; }
        ytToBackfill.push(yt.id);
        added++;
        console.log(`${tag} ADDED YT ${yt.subscriberCount.toLocaleString()} subs (backfill queued)`);
      } else {
        const results = await searchPodcasts(c.query || c.name);
        const top = results[0];
        if (!top) { console.log(`${tag} ✗    no PodScan match for "${c.query}"`); dropped++; continue; }
        const id = pickId(top), title = pickTitle(top), reach = pickReach(top);
        if (!id) { console.log(`${tag} ✗    match "${title}" has no id`); dropped++; continue; }
        const recent = (await getPodcastEpisodes(id, 1).catch(() => [])) as any[];
        const ageD = daysAgo(recent[0]?.posted_at || recent[0]?.published_at);
        const flags = [ageD > STALE_DAYS ? `STALE(${ageD}d)` : ""].filter(Boolean);
        if (!APPLY) {
          const alt = results[1] ? ` | #2:${pickTitle(results[1]).slice(0, 18)}` : "";
          console.log(`${tag} ${reach.toLocaleString().padStart(11)} · last ${ageD}d${flags.length ? "  ⚠ " + flags.join(",") : "  OK"} · "${title.slice(0, 22)}"${alt}`);
          continue;
        }
        if (flags.length) { console.log(`${tag} SKIP ${flags.join(",")} ("${title.slice(0, 24)}")`); dropped++; continue; }
        // ingest first so we can ground the rationale on real episode titles
        const eps = (await getPodcastEpisodes(id, 30).catch(() => [])) as any[];
        const rationale = await generateChannelRationale({ title, description: (top as any).description || "", lean: c.lean, recentTitles: eps.slice(0, 8).map((e) => e.episode_title || e.title).filter(Boolean) });
        const { data: ins, error } = await db.from("channels").insert({
          name: c.name, platform: "podcast", platform_id: id, political_lean: c.lean,
          cohort: c.cohort, reach, classification_rationale: rationale, active: true,
        }).select("id").single();
        if (error || !ins) { console.log(`${tag} FAIL ${error?.message}`); dropped++; continue; }
        let kept = 0, tx = 0; const seen = new Set<string>();
        for (const ep of eps) {
          const url = uniqueSourceUrl(ep);
          const published = ep.posted_at || ep.published_at || ep.created_at;
          const duration = ep.episode_duration ?? ep.duration ?? 0;
          const text = ep.episode_transcript || ep.transcript || ep.text;
          if (!url || !published || Number(duration) < MIN_DURATION_SEC || seen.has(url)) continue;
          seen.add(url);
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
        added++;
        console.log(`${tag} ADDED ${reach.toLocaleString()} · ${kept} eps (${tx} tx)`);
      }
    } catch (e: any) { console.log(`${tag} ERR  ${e.message?.slice(0, 60)}`); dropped++; }
  }

  console.log(`\n${"─".repeat(70)}`);
  if (APPLY) {
    console.log(`Added: ${added} · dropped/skipped: ${dropped}`);
    if (ytToBackfill.length) console.log(`\nBackfill the new YT channels (per-day cap):\n  npm run backfill:channel-history -- 3 30 ${ytToBackfill.join(",")}`);
    console.log(`Then: npm run drain && npm run refresh:snapshot`);
  } else {
    console.log(`Resolved-and-OK candidates are shown above; ⚠ = will be SKIPPED on --apply. Re-run with --apply --tranche=${TRANCHE}.`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
