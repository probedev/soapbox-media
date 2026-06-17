/**
 * channels - consolidated channel-expansion + cleanup CLI.
 *
 * Replaces the fragmented discover and seed scripts with one repeatable
 * research -> vet -> review -> approve -> promote loop, plus panel cleanup.
 * Candidates persist in `channel_candidates`; dedup runs centrally against the
 * live `channels` table via src/lib/channel-dedup. Nothing reaches the panel
 * without MANUAL approval (`review` -> `approve` -> `promote`).
 *
 * Subcommands:
 *   discover [--source featured|itunes]  Find + persist candidates (writes to
 *            [--editorial file.json]     channel_candidates; dedups vs panel).
 *                                        Editorial JSON is the primary path to +70.
 *   vet                                  Score `new` candidates (reach floor =
 *                                        YouTube only, recency); set status.
 *   relevance                            LLM screen: demote off-topic / foreign
 *                                        candidates to `rejected` (reversible).
 *   review [--status vetted] [--csv P]   Print + CSV the ranked candidate list.
 *   approve --ids <p,p> [--lean L]       Set candidates approved/rejected;
 *           [--cohort independent] [--reject]   assign lean/cohort. (id prefix ok)
 *   promote [--apply]                    Onboard APPROVED candidates (dry-run
 *                                        default). YT by id, podcast by name.
 *   audit                                Read-only panel health report.
 *   prune [--apply] [--stale-days 30]    Disable stale/empty feeds; report
 *         [--min-age-days 7]             invariant violations (fix via flags).
 *         [--fix-lean "Name=L"] [--fix-cohort "Name=independent"]
 *
 * Run: npm run channels -- <subcommand> [flags]
 */
import "./_load-env";

import * as fs from "fs";
import { createServiceClient } from "@/lib/db";
import { getFeaturedChannels, getChannelDetailsBatch } from "@/lib/youtube";
import { searchITunesPodcasts } from "@/lib/apple-podcasts";
import { matchChannel, normalizeName } from "@/lib/channel-dedup";
import { vetCandidate } from "@/lib/channel-vet";
import { addYouTubeChannelById, addPodcastChannel, resolveLiveFeed } from "@/lib/channels";
import { pickPodcastId } from "@/lib/podscan";
import { getAnthropicClient, MODEL_RATIONALE, MODEL_CLASSIFY } from "@/lib/anthropic";

type Platform = "youtube" | "podcast";
type Lean = "L" | "M" | "R";
type Cohort = "independent" | "legacy";

interface ExistingChannel {
  id: string;
  name: string;
  platform: Platform;
  platform_id: string | null;
  political_lean: Lean | null;
  cohort: Cohort | null;
  active: boolean;
  reach: number;
  created_at: string;
}

interface Candidate {
  id: string;
  name: string;
  platform: Platform;
  platform_id: string | null;
  source_ref: string | null;
  source: string;
  endorsements: number;
  candidate_reach: number | null;
  political_lean: Lean | null;
  cohort: Cohort;
  latest_episode_at: string | null;
  status: string;
  dedup_reason: string | null;
  promoted_channel_id: string | null;
}

const db = createServiceClient();

// iTunes search terms + legacy-network patterns (lifted from discover-podcasts).
const SEARCH_TERMS = [
  "politics",
  "political commentary",
  "political news",
  "conservative politics",
  "progressive politics",
  "news commentary",
];
const LEGACY_ARTIST_PATTERNS = [
  "npr", "national public radio", "new york times", "nyt", "cnn", "msnbc",
  "nbc news", "abc news", "cbs news", "fox news podcasts", "fox news radio",
  "bbc", "wall street journal", "washington post", "pbs", "politico",
  "bloomberg", "reuters", "the atlantic", "the economist", "time magazine",
  "axios", "los angeles times", "usa today",
];
function looksLegacy(artist: string): boolean {
  const lower = (artist || "").toLowerCase();
  return LEGACY_ARTIST_PATTERNS.some((p) => lower.includes(p));
}

// Short-form channels we want to KEEP even when they look empty/stale (their
// clips fall below the duration floor or yield few mentions). See NowThis Impact.
const SHORT_FORM_EXEMPT = new Set(["nowthisimpact"]);
function isExempt(name: string): boolean {
  return SHORT_FORM_EXEMPT.has(normalizeName(name));
}

// ---- flag parsing -------------------------------------------------------
const argv = process.argv.slice(2);
const sub = argv[0];
const APPLY = argv.includes("--apply");
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}
function listFlag(name: string): string[] {
  const i = argv.indexOf(`--${name}`);
  const raw =
    i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
      ? argv[i + 1]
      : argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
function parseKv(items: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const it of items) {
    const i = it.indexOf("=");
    if (i > 0) o[it.slice(0, i).trim()] = it.slice(i + 1).trim();
  }
  return o;
}

// ---- shared loaders -----------------------------------------------------
async function loadChannels(): Promise<ExistingChannel[]> {
  const out: ExistingChannel[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("channels")
      .select("id, name, platform, platform_id, political_lean, cohort, active, reach, created_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load channels: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as ExistingChannel[]));
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadCandidates(statuses?: string[]): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from("channel_candidates")
      .select(
        "id, name, platform, platform_id, source_ref, source, endorsements, candidate_reach, political_lean, cohort, latest_episode_at, status, dedup_reason, promoted_channel_id",
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (statuses && statuses.length) q = q.in("status", statuses);
    const { data, error } = await q;
    if (error) throw new Error(`load candidates: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as Candidate[]));
    if (data.length < PAGE) break;
  }
  return out;
}

function candKey(platform: string, platform_id: string | null, source_ref: string | null): string {
  return `${platform}|${platform_id || source_ref || ""}`;
}

// Classify a candidate against the live panel: same-platform match = duplicate;
// cross-platform name match = sibling (the show is already covered on the OTHER
// platform - excluded under the new-shows-only policy); no match = genuinely new.
function classifyAgainstPanel(
  cand: { name: string; platform: Platform; platform_id: string | null },
  channels: ExistingChannel[],
): { kind: "duplicate" | "sibling" | "new"; reason: string | null } {
  const m = matchChannel(cand, channels);
  if (m.match && m.samePlatform) return { kind: "duplicate", reason: `${m.reason} == ${m.match.name}` };
  if (m.match && !m.samePlatform) {
    return { kind: "sibling", reason: `sibling: already on ${m.match.platform} (${m.match.name})` };
  }
  return { kind: "new", reason: null };
}

// ---- formatting ---------------------------------------------------------
function fmtReach(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}
function printTable(rows: string[][]): void {
  if (!rows.length) return;
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  for (const r of rows) console.log(r.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  "));
}
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---- discover -----------------------------------------------------------
interface Disc {
  name: string;
  platform: Platform;
  platform_id: string | null;
  source_ref: string;
  source: string;
  endorsements: number;
  candidate_reach: number | null;
  cohort: Cohort;
  latest_episode_at: string | null;
  political_lean?: Lean | null;
}

async function discover(): Promise<void> {
  const editorialFile = flag("editorial");
  const only = listFlag("source");
  // `--editorial <file>` ingests a curated list ONLY (the primary path to +70,
  // since featured adjacency is largely tapped at 180 shows); otherwise the
  // automatic featured + iTunes sources run.
  const wantFeatured = only.includes("featured") || (!only.length && !editorialFile);
  const wantItunes = only.includes("itunes") || (!only.length && !editorialFile);

  const existing = (await loadChannels()).filter((c) => c.active);
  const have = await loadCandidates();
  const byKey = new Map<string, Candidate>();
  for (const c of have) byKey.set(candKey(c.platform, c.platform_id, c.source_ref), c);

  const discovered: Disc[] = [];

  if (wantFeatured) {
    const yt = existing.filter((c) => c.platform === "youtube" && c.platform_id);
    const ownedIds = new Set(yt.map((c) => c.platform_id));
    const featuredBy = new Map<string, Set<string>>();
    console.error(`discover: scanning featured channels of ${yt.length} YouTube channels...`);
    for (const ch of yt) {
      try {
        const featured = await getFeaturedChannels(ch.platform_id!);
        for (const id of featured) {
          if (ownedIds.has(id)) continue;
          const s = featuredBy.get(id) ?? new Set<string>();
          s.add(ch.name);
          featuredBy.set(id, s);
        }
      } catch (e) {
        console.error(`  [${ch.name}] featured fetch failed: ${(e as Error).message}`);
      }
    }
    const ids = [...featuredBy.keys()];
    if (ids.length) {
      const details = await getChannelDetailsBatch(ids);
      for (const id of ids) {
        const d = details.get(id);
        if (!d) continue;
        discovered.push({
          name: d.title,
          platform: "youtube",
          platform_id: id,
          source_ref: id,
          source: "featured",
          endorsements: featuredBy.get(id)!.size,
          candidate_reach: d.subscriberCount,
          cohort: "independent",
          latest_episode_at: null,
        });
      }
    }
  }

  if (wantItunes) {
    const merged = new Map<number, { name: string; artist: string; genre: string; release?: string; terms: Set<string> }>();
    console.error(`discover: searching iTunes (${SEARCH_TERMS.length} terms)...`);
    for (const term of SEARCH_TERMS) {
      try {
        const rs = await searchITunesPodcasts(term, 50);
        for (const r of rs) {
          const cur = merged.get(r.collectionId);
          if (!cur)
            merged.set(r.collectionId, {
              name: r.collectionName,
              artist: r.artistName,
              genre: r.primaryGenreName || "",
              release: r.releaseDate,
              terms: new Set([term]),
            });
          else cur.terms.add(term);
        }
      } catch (e) {
        console.error(`  [${term}] iTunes search failed: ${(e as Error).message}`);
      }
    }
    for (const m of merged.values()) {
      const g = m.genre.toLowerCase();
      if (!g.includes("politic") && !g.includes("news")) continue;
      discovered.push({
        name: m.name,
        platform: "podcast",
        platform_id: null,
        source_ref: m.name,
        source: "itunes",
        endorsements: m.terms.size,
        candidate_reach: null,
        // Legacy outlets are tagged (not dropped): honest-imbalance + the live
        // legacy cohort means a human can still admit them during review.
        cohort: looksLegacy(m.artist) ? "legacy" : "independent",
        latest_episode_at: m.release ?? null,
      });
    }
  }

  if (editorialFile) {
    const raw = JSON.parse(fs.readFileSync(editorialFile, "utf8")) as Array<{
      name: string;
      platform: Platform;
      platform_id?: string | null;
      source_ref?: string;
      lean?: Lean;
      cohort?: Cohort;
      reach?: number;
      latest_episode_at?: string;
    }>;
    let loaded = 0;
    for (const e of raw) {
      if (!e.name || (e.platform !== "youtube" && e.platform !== "podcast")) {
        console.error(`  editorial: skipping malformed entry ${JSON.stringify(e).slice(0, 80)}`);
        continue;
      }
      discovered.push({
        name: e.name,
        platform: e.platform,
        platform_id: e.platform_id ?? null,
        source_ref: e.source_ref ?? e.platform_id ?? e.name,
        source: "editorial",
        endorsements: 0,
        candidate_reach: e.reach ?? null,
        cohort: e.cohort ?? "independent",
        latest_episode_at: e.latest_episode_at ?? null,
        political_lean: e.lean ?? null,
      });
      loaded++;
    }
    console.error(`discover: loaded ${loaded} editorial entries from ${editorialFile}`);
  }

  let inserted = 0;
  let updated = 0;
  let dupes = 0;
  let sibs = 0;
  for (const d of discovered) {
    const cls = classifyAgainstPanel({ name: d.name, platform: d.platform, platform_id: d.platform_id }, existing);
    if (cls.kind === "duplicate") dupes++;
    else if (cls.kind === "sibling") sibs++;
    const autoStatus = cls.kind === "duplicate" ? "duplicate" : cls.kind === "sibling" ? "rejected" : "new";
    const prev = byKey.get(candKey(d.platform, d.platform_id, d.source_ref));
    if (prev) {
      const patch: Record<string, unknown> = {
        endorsements: d.endorsements,
        candidate_reach: d.candidate_reach ?? prev.candidate_reach,
        latest_episode_at: d.latest_episode_at ?? prev.latest_episode_at,
        updated_at: new Date().toISOString(),
      };
      // Re-mark only if still in an automatic status (never clobber a human's
      // approved/rejected/promoted decision).
      if (cls.kind !== "new" && (prev.status === "new" || prev.status === "vetted")) {
        patch.status = autoStatus;
        patch.dedup_reason = cls.reason;
      }
      await db.from("channel_candidates").update(patch).eq("id", prev.id);
      updated++;
    } else {
      await db.from("channel_candidates").insert({
        name: d.name,
        platform: d.platform,
        platform_id: d.platform_id,
        source_ref: d.source_ref,
        source: d.source,
        endorsements: d.endorsements,
        candidate_reach: d.candidate_reach,
        cohort: d.cohort,
        political_lean: d.political_lean ?? null,
        latest_episode_at: d.latest_episode_at,
        status: autoStatus,
        dedup_reason: cls.reason,
      });
      inserted++;
    }
  }

  console.log(
    `discover: ${discovered.length} found (${inserted} inserted, ${updated} updated) · ` +
      `${dupes} duplicates · ${sibs} siblings excluded (already on other platform)`,
  );
  console.log(`Next: npm run channels -- vet`);
}

// ---- vet ----------------------------------------------------------------
async function vet(): Promise<void> {
  const cands = await loadCandidates(["new"]);
  let v = 0;
  let bf = 0;
  let st = 0;
  for (const c of cands) {
    const res = vetCandidate({
      name: c.name,
      platform: c.platform,
      reach: c.candidate_reach,
      political_lean: c.political_lean,
      latest_episode_at: c.latest_episode_at,
    });
    await db
      .from("channel_candidates")
      .update({ status: res.status, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (res.status === "vetted") v++;
    else if (res.status === "below_floor") bf++;
    else st++;
  }
  console.log(`vet: ${cands.length} candidates · ${v} vetted · ${bf} below_floor · ${st} stale`);
  console.log(`Next: npm run channels -- relevance   (LLM screen), then review`);
}

// ---- siblings (enforce new-shows-only on the current pool) --------------
// discover applies this automatically going forward; this sweeps a pool that
// was discovered before the policy existed. Demotes any vetted candidate whose
// show is already in the panel on the other platform.
async function siblings(): Promise<void> {
  const channels = (await loadChannels()).filter((c) => c.active);
  const cands = await loadCandidates(["vetted"]);
  let sib = 0;
  let dup = 0;
  for (const c of cands) {
    const cls = classifyAgainstPanel({ name: c.name, platform: c.platform, platform_id: c.platform_id }, channels);
    if (cls.kind === "sibling") {
      await db
        .from("channel_candidates")
        .update({ status: "rejected", dedup_reason: cls.reason, updated_at: new Date().toISOString() })
        .eq("id", c.id);
      console.log(`  sibling   ${c.name} (${cls.reason})`);
      sib++;
    } else if (cls.kind === "duplicate") {
      // Same-platform exact/contained match that the original (buggy) matcher
      // missed by matching a wrong cross-platform channel first. These are true
      // duplicates of an existing panel row.
      await db
        .from("channel_candidates")
        .update({ status: "duplicate", dedup_reason: cls.reason, updated_at: new Date().toISOString() })
        .eq("id", c.id);
      console.log(`  duplicate ${c.name} (${cls.reason})`);
      dup++;
    }
  }
  console.log(`siblings: ${sib} siblings + ${dup} same-platform duplicates demoted (new-shows-only)`);
  console.log(`Review survivors: npm run channels -- review`);
}

// ---- recover (re-resolve stale podcasts to a live feed) -----------------
// For shows pointed at a stale/misresolved PodScan feed (an active host whose
// feed shows years-old episodes): re-resolve to the live feed and re-ingest,
// preserving the editorial name/lean/cohort/reach. If no live feed exists, the
// show is genuinely gone, so prune it (delete, cascade episodes).
async function recover(): Promise<void> {
  const names = listFlag("names");
  if (!names.length) {
    console.error('recover: pass --names "Show A,Show B" (podcast shows to re-resolve)');
    process.exit(1);
  }
  const channels = await loadChannels();
  let rec = 0;
  let pruned = 0;
  let failed = 0;
  for (const name of names) {
    const ch = channels.find(
      (c) => c.platform === "podcast" && c.active && normalizeName(c.name) === normalizeName(name),
    );
    if (!ch) {
      console.error(`  no active podcast channel "${name}"`);
      continue;
    }
    if (!APPLY) {
      console.log(`  would re-resolve ${ch.name}`);
      continue;
    }
    let pod;
    try {
      pod = await resolveLiveFeed(ch.name);
    } catch (e) {
      // No live feed -> the show is genuinely gone. Prune it.
      await db.from("channels").delete().eq("id", ch.id);
      console.log(`  PRUNED ${ch.name}: ${(e as Error).message}`);
      pruned++;
      continue;
    }
    // Live feed found: delete the stale row, re-add on the fresh feed, keeping
    // the editorial name/lean/cohort/reach.
    await db.from("channels").delete().eq("id", ch.id);
    try {
      const r = await addPodcastChannel({
        podcastId: pickPodcastId(pod) ?? undefined,
        lean: ch.political_lean as "L" | "M" | "R",
        cohort: (ch.cohort ?? "independent") as Cohort,
        reachOverride: ch.reach,
        nameOverride: ch.name,
      });
      console.log(`  RECOVERED ${ch.name} -> ${r.upserted} eps (${r.transcripts} tx)`);
      rec++;
    } catch (e) {
      console.log(`  FAIL ${ch.name}: ${(e as Error).message}`);
      failed++;
    }
  }
  console.log(`recover: ${rec} recovered · ${pruned} pruned (no live feed) · ${failed} failed`);
}

// ---- relevance (LLM screen) ---------------------------------------------
// The featured-channels path has no topic filter, so it surfaces non-political
// and foreign-language channels that clear the reach/recency vet. A cheap,
// batched Haiku pass demotes high-confidence noise to `rejected` (with the
// reason in dedup_reason), biased to KEEP when uncertain since a human approves
// the survivors. Reversible: inspect with `review --status rejected`.
interface Verdict {
  political: boolean;
  usEnglish: boolean;
}

async function judgeRelevance(names: string[]): Promise<Verdict[]> {
  const list = names.map((n, i) => `${i + 1}. ${n}`).join("\n");
  const prompt =
    `You are screening media channels for a US political-discourse tracker. For each ` +
    `channel below, decide two booleans:\n` +
    `- political: true if it is primarily US political/news/commentary (talk, news, ` +
    `opinion, policy). false if it is entertainment, music, sports, lifestyle, ` +
    `nature/documentary, drama, comedy, or otherwise not political.\n` +
    `- usEnglish: true if US-based AND English-language. false if foreign-language or a ` +
    `non-US outlet.\n` +
    `When uncertain, default BOTH to true (a human reviews the survivors).\n` +
    `Return ONLY a JSON array, one object per channel IN ORDER: ` +
    `[{"political":true,"usEnglish":true}, ...]. No prose.\n\nChannels:\n${list}`;
  try {
    const res = await getAnthropicClient().messages.create({
      model: MODEL_RATIONALE,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const m = text.match(/\[[\s\S]*\]/);
    const arr = m ? (JSON.parse(m[0]) as Verdict[]) : [];
    return names.map((_, i) => arr[i] ?? { political: true, usEnglish: true });
  } catch {
    // On any failure, keep everything (never silently drop on a model/parse error).
    return names.map(() => ({ political: true, usEnglish: true }));
  }
}

async function relevance(): Promise<void> {
  const cands = await loadCandidates(["vetted"]);
  if (!cands.length) {
    console.log("relevance: no vetted candidates (run discover + vet first).");
    return;
  }
  const CHUNK = 30;
  let kept = 0;
  let demoted = 0;
  for (let i = 0; i < cands.length; i += CHUNK) {
    const batch = cands.slice(i, i + CHUNK);
    console.error(`relevance: screening ${i + 1}-${i + batch.length} of ${cands.length}...`);
    const verdicts = await judgeRelevance(batch.map((c) => c.name));
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const v = verdicts[j];
      if (v.political && v.usEnglish) {
        kept++;
        continue;
      }
      const reason = !v.political ? "off-topic (not political)" : "non-US/English";
      await db
        .from("channel_candidates")
        .update({ status: "rejected", dedup_reason: `relevance: ${reason}`, updated_at: new Date().toISOString() })
        .eq("id", c.id);
      demoted++;
    }
  }
  console.log(`relevance: ${cands.length} screened · ${kept} kept (vetted) · ${demoted} demoted to rejected`);
  console.log(`Survivors: npm run channels -- review`);
  console.log(`What was cut: npm run channels -- review --status rejected`);
}

// Draft a one-line site-voice description per candidate from its name. Batched
// Haiku, same house style as generateChannelRationale. Name-only (fast) - good
// enough for a review printout; the grounded rationale is drafted at promote.
async function describeCandidates(names: string[]): Promise<string[]> {
  const examples = [
    "Flagship Democratic-adjacent podcast; ex-Obama staffers.",
    "Long-form interviews; broadly non-partisan, contrarian-friendly.",
    "Krystal Ball (L) + Saagar Enjeti (R-populist); explicit heterodox bridge show.",
    "Hard-right cultural commentary; trans/gender focus.",
    "CBS News' flagship Sunday newsmagazine; investigative reports. Center-of-the-dial.",
  ];
  const out: string[] = [];
  const CHUNK = 25;
  for (let i = 0; i < names.length; i += CHUNK) {
    const batch = names.slice(i, i + CHUNK);
    const prompt =
      `Write a ONE-LINE description (max ~18 words) for each US political show below, ` +
      `using the show name AND your knowledge. Infer the host/network and political lean ` +
      `from the name (e.g. "Meet the Press" = NBC's Sunday political show, center; "The ` +
      `Tucker Carlson Show" = Tucker Carlson, right-populist; "Pod Save America" = ex-Obama ` +
      `staffers, left). Match this house style (concrete, posture-first; name host/network ` +
      `+ format + political character; no hype, no em dashes):\n` +
      examples.map((e) => `- ${e}`).join("\n") +
      `\n\nOnly if a name is genuinely too generic to infer ANYTHING, write "Generic name - ` +
      `verify." Return ONLY a JSON array of strings, one per show IN ORDER. No prose.\n\nShows:\n` +
      batch.map((n, j) => `${j + 1}. ${n}`).join("\n");
    try {
      const res = await getAnthropicClient().messages.create({
        model: MODEL_CLASSIFY,
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      });
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const m = text.match(/\[[\s\S]*\]/);
      const arr = m ? (JSON.parse(m[0]) as string[]) : [];
      batch.forEach((_, j) => out.push(arr[j] ?? ""));
    } catch {
      batch.forEach(() => out.push(""));
    }
  }
  return out;
}

// ---- review -------------------------------------------------------------
async function review(): Promise<void> {
  const status = flag("status") || "vetted";
  const platformFilter = flag("platform"); // optional: youtube | podcast
  let cands = (await loadCandidates([status])).sort(
    (a, b) => b.endorsements - a.endorsements || (b.candidate_reach ?? 0) - (a.candidate_reach ?? 0),
  );
  if (platformFilter) cands = cands.filter((c) => c.platform === platformFilter);

  const wantDesc = argv.includes("--describe");
  const descs = wantDesc ? await describeCandidates(cands.map((c) => c.name)) : [];

  console.log(`\n${cands.length} ${status} candidates (sorted by endorsements, then reach)\n`);
  if (wantDesc) {
    cands.forEach((c, i) => {
      const meta = [
        c.id.slice(0, 8),
        c.platform === "youtube" ? "YT" : "PC",
        c.cohort,
        c.candidate_reach ? fmtReach(c.candidate_reach) : c.latest_episode_at ? c.latest_episode_at.slice(0, 10) : "",
        `endo ${c.endorsements}`,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`- ${c.name}  [${meta}]\n    ${descs[i] || "(no description)"}`);
    });
  } else {
    const header = ["id", "name", "plat", "lean", "cohort", "reach", "recency", "src", "endo", "dedup"];
    const rows: string[][] = [header];
    for (const c of cands) {
      rows.push([
        c.id.slice(0, 8),
        c.name.slice(0, 40),
        c.platform === "youtube" ? "YT" : "PC",
        c.political_lean ?? "?",
        c.cohort,
        c.candidate_reach ? fmtReach(c.candidate_reach) : "-",
        c.latest_episode_at ? c.latest_episode_at.slice(0, 10) : "?",
        c.source,
        String(c.endorsements),
        c.dedup_reason ?? "",
      ]);
    }
    printTable(rows);
  }

  const csvPath = flag("csv") || "/tmp/channel-candidates-review.csv";
  const csvRows = [["id", "name", "platform", "lean", "cohort", "reach", "recency", "src", "endo", "description"]];
  cands.forEach((c, i) => {
    csvRows.push([
      c.id,
      c.name,
      c.platform,
      c.political_lean ?? "",
      c.cohort,
      String(c.candidate_reach ?? ""),
      c.latest_episode_at ?? "",
      c.source,
      String(c.endorsements),
      wantDesc ? descs[i] ?? "" : "",
    ]);
  });
  fs.writeFileSync(csvPath, csvRows.map((r) => r.map(csvCell).join(",")).join("\n"));
  console.log(`\nCSV (full ids): ${csvPath}`);
  console.log(
    `Approve: npm run channels -- approve --ids <idPrefix,idPrefix> --lean <L|M|R> [--cohort independent|legacy]`,
  );
}

// ---- approve ------------------------------------------------------------
async function approve(): Promise<void> {
  const ids = listFlag("ids");
  const reject = argv.includes("--reject");
  const lean = flag("lean") as Lean | undefined;
  const cohort = flag("cohort") as Cohort | undefined;
  if (!ids.length) {
    console.error("approve: pass --ids <idPrefix,idPrefix> (8-char prefixes from review are fine)");
    process.exit(1);
  }
  const all = await loadCandidates();
  let n = 0;
  for (const token of ids) {
    const matches = all.filter((c) => c.id === token || c.id.startsWith(token));
    if (matches.length === 0) {
      console.error(`  no candidate matches "${token}"`);
      continue;
    }
    if (matches.length > 1) {
      console.error(`  ambiguous prefix "${token}" (${matches.length} matches) - use a longer id`);
      continue;
    }
    const c = matches[0];
    const patch: Record<string, unknown> = {
      status: reject ? "rejected" : "approved",
      updated_at: new Date().toISOString(),
    };
    if (lean) patch.political_lean = lean;
    if (cohort) patch.cohort = cohort;
    await db.from("channel_candidates").update(patch).eq("id", c.id);
    console.log(`  ${reject ? "rejected" : "approved"} ${c.name}${lean ? ` (lean ${lean})` : ""}`);
    n++;
  }
  console.log(`approve: ${n} updated`);
  if (!reject && n) console.log(`Promote: npm run channels -- promote          (dry-run)\n        npm run channels -- promote --apply`);
}

// ---- promote ------------------------------------------------------------
async function promote(): Promise<void> {
  const cands = await loadCandidates(["approved"]);
  if (!cands.length) {
    console.log("promote: no approved candidates.");
    return;
  }
  console.log(`\n${APPLY ? "PROMOTING" : "DRY RUN"} - ${cands.length} approved candidates\n`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const c of cands) {
    if (!c.political_lean) {
      console.log(`  SKIP ${c.name}: no lean assigned (re-approve with --lean)`);
      skipped++;
      continue;
    }
    if (!APPLY) {
      console.log(`  would promote ${c.platform === "youtube" ? "YT" : "PC"} ${c.name} (${c.political_lean}/${c.cohort})`);
      continue;
    }
    try {
      let newId: string;
      if (c.platform === "youtube") {
        if (!c.platform_id) {
          console.log(`  SKIP ${c.name}: youtube candidate without a channel id`);
          skipped++;
          continue;
        }
        const r = await addYouTubeChannelById({
          channelId: c.platform_id,
          lean: c.political_lean,
          cohort: c.cohort,
          reachOverride: c.candidate_reach ?? undefined,
        });
        newId = r.channelId;
        console.log(`  + ${r.name} (${r.upserted} eps)`);
      } else {
        const r = await addPodcastChannel({
          query: c.source_ref || c.name,
          podcastId: c.platform_id || undefined,
          lean: c.political_lean,
          cohort: c.cohort,
          reachOverride: c.candidate_reach ?? undefined,
        });
        newId = r.channelId;
        console.log(`  + ${r.name} (${r.upserted} eps, ${r.transcripts} tx)`);
      }
      await db
        .from("channel_candidates")
        .update({ status: "promoted", promoted_channel_id: newId, updated_at: new Date().toISOString() })
        .eq("id", c.id);
      ok++;
    } catch (e) {
      console.log(`  FAIL ${c.name}: ${(e as Error).message}`);
      failed++;
    }
  }
  console.log(`\npromote: ${ok} promoted · ${skipped} skipped · ${failed} failed`);
  if (APPLY && ok) console.log(`Then: npm run drain && npm run refresh:snapshot`);
}

// ---- health (shared by audit + prune) -----------------------------------
interface Health {
  active: ExistingChannel[];
  latestByChannel: Map<string, string | null>;
  empty: ExistingChannel[];
  stale: { c: ExistingChannel; latest: string; days: number }[];
  veryStale: { c: ExistingChannel; latest: string; days: number }[];
  violations: { name: string; leans: string; cohorts: string }[];
}

async function computeHealth(staleDays: number): Promise<Health> {
  const channels = await loadChannels();
  const active = channels.filter((c) => c.active);
  const now = Date.now();
  const latestByChannel = new Map<string, string | null>();
  const empty: ExistingChannel[] = [];
  const stale: Health["stale"] = [];
  const veryStale: Health["veryStale"] = [];

  for (const c of active) {
    const { data } = await db
      .from("episodes")
      .select("published_at")
      .eq("channel_id", c.id)
      .order("published_at", { ascending: false })
      .limit(1);
    const latest = data && data.length ? (data[0].published_at as string) : null;
    latestByChannel.set(c.id, latest);
    if (!latest) {
      empty.push(c);
      continue;
    }
    const days = (now - Date.parse(latest)) / 86_400_000;
    if (days > staleDays) veryStale.push({ c, latest, days });
    else if (days > 14) stale.push({ c, latest, days });
  }

  // Invariant: rows sharing a name must share lean + cohort.
  const byName = new Map<string, ExistingChannel[]>();
  for (const c of active) {
    const arr = byName.get(c.name) ?? [];
    arr.push(c);
    byName.set(c.name, arr);
  }
  const violations: Health["violations"] = [];
  for (const [name, rows] of byName) {
    if (rows.length < 2) continue;
    const leans = new Set(rows.map((r) => r.political_lean ?? "?"));
    const cohorts = new Set(rows.map((r) => r.cohort ?? "?"));
    if (leans.size > 1 || cohorts.size > 1) {
      violations.push({ name, leans: [...leans].join("/"), cohorts: [...cohorts].join("/") });
    }
  }

  return { active, latestByChannel, empty, stale, veryStale, violations };
}

// ---- audit --------------------------------------------------------------
async function audit(): Promise<void> {
  const staleDays = parseInt(flag("stale-days") || "30", 10);
  console.error(`audit: reading latest-episode dates for active channels...`);
  const h = await computeHealth(staleDays);
  console.log(`\nPanel health - ${h.active.length} active channels\n`);
  console.log(`Stale 14-${staleDays}d (publishing slowed): ${h.stale.length}`);
  for (const s of h.stale) console.log(`  · ${s.c.name} (last ${Math.round(s.days)}d ago)`);
  console.log(`\nVery stale >${staleDays}d (disable candidates): ${h.veryStale.length}`);
  for (const s of h.veryStale) console.log(`  · ${s.c.name} (last ${Math.round(s.days)}d ago)${isExempt(s.c.name) ? " [EXEMPT short-form]" : ""}`);
  console.log(`\nZero-episode active: ${h.empty.length}`);
  for (const e of h.empty) console.log(`  · ${e.name} (added ${e.created_at.slice(0, 10)})${isExempt(e.name) ? " [EXEMPT short-form]" : ""}`);
  console.log(`\nLean/cohort invariant violations: ${h.violations.length}`);
  for (const v of h.violations) console.log(`  · ${v.name}: leans=${v.leans} cohorts=${v.cohorts}`);
  console.log(`\nNote: this flags non-publishing feeds. A "publishing but unclassified" check`);
  console.log(`(transcript-aware off-topic detection) is a planned refinement.`);
  console.log(`\nTo act: npm run channels -- prune            (dry-run)`);
}

// ---- prune --------------------------------------------------------------
async function prune(): Promise<void> {
  const staleDays = parseInt(flag("stale-days") || "30", 10);
  const minAge = parseInt(flag("min-age-days") || "7", 10);
  const now = Date.now();
  console.error(`prune: reading latest-episode dates for active channels...`);
  const h = await computeHealth(staleDays);

  // Disable candidates: very-stale feeds + zero-episode channels older than
  // min-age, minus the short-form exemptions.
  const staleToDisable = h.veryStale.filter((s) => !isExempt(s.c.name));
  const emptyToDisable = h.empty.filter(
    (e) => !isExempt(e.name) && (now - Date.parse(e.created_at)) / 86_400_000 >= minAge,
  );
  const toDisable = staleToDisable.length + emptyToDisable.length;
  const frac = toDisable / Math.max(h.active.length, 1);

  console.log(`\n${APPLY ? "PRUNING" : "DRY RUN"} - ${h.active.length} active channels`);
  console.log(
    `disable: ${staleToDisable.length} stale (>${staleDays}d) + ${emptyToDisable.length} empty (age>=${minAge}d) · invariant violations: ${h.violations.length}`,
  );

  // Systemic-outage guard: if a big fraction look dead at once, that is almost
  // certainly an ingest/provider outage, not a wave of dead feeds. Abort.
  if (frac > 0.25) {
    console.error(
      `\nABORT: ${(frac * 100).toFixed(0)}% of active channels would be disabled - looks like an ` +
        `ingest/provider outage, not dead feeds. Verify ingest is current before pruning.`,
    );
    process.exit(1);
  }

  for (const s of staleToDisable) console.log(`  STALE  ${s.c.name} (last ${Math.round(s.days)}d ago)`);
  for (const e of emptyToDisable) console.log(`  EMPTY  ${e.name} (added ${e.created_at.slice(0, 10)}, 0 episodes)`);
  for (const v of h.violations)
    console.log(
      `  INVARIANT ${v.name}: leans=${v.leans} cohorts=${v.cohorts} ` +
        `(fix: --fix-lean "${v.name}=L" --fix-cohort "${v.name}=independent")`,
    );

  if (!APPLY) {
    console.log(`\nDry run. Re-run with --apply to disable stale/empty.`);
    console.log(`Invariant fixes are editorial: pass --fix-lean / --fix-cohort explicitly.`);
    return;
  }

  for (const s of staleToDisable) await db.from("channels").update({ active: false }).eq("id", s.c.id);
  for (const e of emptyToDisable) await db.from("channels").update({ active: false }).eq("id", e.id);

  const leanFixes = parseKv(listFlag("fix-lean"));
  const cohortFixes = parseKv(listFlag("fix-cohort"));
  for (const [name, lean] of Object.entries(leanFixes)) {
    await db.from("channels").update({ political_lean: lean }).eq("name", name);
    console.log(`  fixed lean: ${name} -> ${lean}`);
  }
  for (const [name, coh] of Object.entries(cohortFixes)) {
    await db.from("channels").update({ cohort: coh }).eq("name", name);
    console.log(`  fixed cohort: ${name} -> ${coh}`);
  }

  console.log(`\nprune: disabled ${staleToDisable.length} stale + ${emptyToDisable.length} empty`);
  console.log(`Then: npm run refresh:snapshot`);
}

// ---- dispatch -----------------------------------------------------------
async function main(): Promise<void> {
  switch (sub) {
    case "discover":
      await discover();
      break;
    case "vet":
      await vet();
      break;
    case "relevance":
      await relevance();
      break;
    case "siblings":
      await siblings();
      break;
    case "recover":
      await recover();
      break;
    case "review":
      await review();
      break;
    case "approve":
      await approve();
      break;
    case "promote":
      await promote();
      break;
    case "audit":
      await audit();
      break;
    case "prune":
      await prune();
      break;
    default:
      console.log(`Usage: npm run channels -- <subcommand> [flags]\n`);
      console.log(`  discover [--source featured|itunes] [--editorial file.json]`);
      console.log(`  vet                                   score new candidates`);
      console.log(`  relevance                             LLM screen: demote off-topic/foreign`);
      console.log(`  siblings                              demote candidates already on other platform`);
      console.log(`  recover --names "A,B" [--apply]       re-resolve stale podcasts to live feeds`);
      console.log(`  review [--status vetted] [--platform yt|podcast] [--describe] [--csv P]`);
      console.log(`  approve --ids <p,p> [--lean L] [--cohort C] [--reject]`);
      console.log(`  promote [--apply]                     onboard approved candidates`);
      console.log(`  audit                                 panel health report`);
      console.log(`  prune [--apply] [--stale-days 30] [--min-age-days 7]`);
      console.log(`        [--fix-lean "Name=L"] [--fix-cohort "Name=independent"]`);
      process.exit(sub ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
