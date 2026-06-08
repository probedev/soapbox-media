/**
 * READ-ONLY proof-of-concept v2: NAMED-ENTITY burst detection (vs the v1
 * free-n-gram version in probe-event-burst.ts). Tests the hypothesis that
 * proper-noun bursts are dramatically cleaner — self-canonicalizing, ad-
 * suppressed by baseline, no clustering/LLM needed.
 *
 * Extraction (cheap, deterministic, no LLM/model — relies on the confirmed
 * reliable Title-Case in our transcripts):
 *   1. Strip [timestamp] and [SPEAKER_x] tags.
 *   2. Pull MAXIMAL Title-Case runs (1–4 tokens, lowercase connectors like
 *      "of/the/and" allowed mid-run) → "Meet the Press", "Graham Platner".
 *      Maximal runs only, so sub-tokens don't fragment the signal.
 *   3. Drop sentence-initial single common words, drop all-common runs.
 * Burst = recent channel-breadth rate / (baseline rate + smoothing),
 * ranked × log(channels). Breadth floor = cross-channel synchrony signal.
 *
 * No DB writes. Run: npx tsx scripts/probe-entity-burst.ts
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";

const RECENT_DAYS = 3;
const BASELINE_DAYS = 21;
const MIN_CHANNELS = 5;
const TOP_N = 45;
const DAY = 86_400_000;

// Capitalized-at-sentence-start words that aren't entities; also drop these as
// standalone single-token "entities" and trim them from run edges.
const COMMON = new Set(
  ("the a an and but or so if then because also just really actually right well yeah yes no ok okay look " +
   "listen welcome thanks thank hello hi this that these those there here now today tomorrow yesterday we " +
   "you he she they it i what when where who how why our your my his her their let lets we're you're it's " +
   "that's what's here's there's first second next last one two three new more most some all every any " +
   "good great big new old people thing things way time day week year going get got go come came say said " +
   "see look know think want need make made take back over down up out about like mr mrs ms dr sir " +
   "monday tuesday wednesday thursday friday saturday sunday january february march april may june july " +
   "august september october november december god lord").split(/\s+/));

const CONNECTORS = new Set(["of", "the", "and", "for", "de", "von", "la", "del", "da", "&"]);

const isCap = (tok: string) =>
  /^[A-Z][a-z]+/.test(tok) || /^[A-Z]{2,5}$/.test(tok) || /^[A-Z][a-z]*[A-Z][a-z]+$/.test(tok); // McConnell, DeSantis

function clean(text: string): string {
  return text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ");
}

/** Extract maximal Title-Case runs from one document. Returns a Set (doc-freq). */
function extractEntities(text: string): Map<string, number> {
  const out = new Map<string, number>();
  // tokenize keeping word boundaries + sentence enders
  const raw = clean(text).split(/\s+/);
  let i = 0;
  let prevEnder = true; // start of doc behaves like sentence start
  while (i < raw.length) {
    const bare = raw[i].replace(/^[^A-Za-z0-9&]+/, "").replace(/['’]s$/, "").replace(/[^A-Za-z0-9&]+$/, "");
    const endsSentence = /[.!?]/.test(raw[i]);
    if (!bare || !isCap(bare)) { prevEnder = endsSentence; i++; continue; }

    // build a maximal run starting at i
    const run: string[] = [bare];
    let j = i + 1;
    let sentenceStart = prevEnder;
    while (j < raw.length) {
      const nb = raw[j].replace(/^[^A-Za-z0-9&]+/, "").replace(/['’]s$/, "").replace(/[^A-Za-z0-9&]+$/, "");
      const lower = nb.toLowerCase();
      if (isCap(nb)) { run.push(nb); j++; continue; }
      // allow a lowercase connector only if the token AFTER it is capitalized
      if (CONNECTORS.has(lower)) {
        const after = raw[j + 1]?.replace(/^[^A-Za-z0-9&]+/, "").replace(/[^A-Za-z0-9&]+$/, "");
        if (after && isCap(after)) { run.push(lower); j++; continue; }
      }
      break;
    }
    // trim connector if run ended on one
    while (run.length && CONNECTORS.has(run[run.length - 1].toLowerCase())) run.pop();

    // filtering
    let keep = run;
    // a single sentence-initial common word is almost always not an entity
    if (keep.length === 1) {
      const only = keep[0].toLowerCase();
      if (sentenceStart && COMMON.has(only)) keep = [];
      else if (COMMON.has(only)) keep = [];           // common single word anywhere → drop
      else if (only.length < 3) keep = [];            // too short
    } else {
      // multi-token: if it starts with a common word (likely sentence-initial cap), drop that token
      while (keep.length > 1 && COMMON.has(keep[0].toLowerCase())) keep = keep.slice(1);
      if (keep.every((t) => COMMON.has(t.toLowerCase()))) keep = [];
    }

    if (keep.length) {
      const key = keep.join(" ").toLowerCase();
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    prevEnder = /[.!?]/.test(raw[j - 1] ?? "");
    i = j;
  }
  return out;
}

async function pullWindow(
  startISO: string,
  endISO: string,
  onDoc: (entities: Map<string, number>, channelId: string, channelName: string) => void,
): Promise<number> {
  const db = createServiceClient();
  const pageSize = 200;
  let docs = 0;
  for (let page = 0; page < 200; page++) {
    const { data, error } = await db
      .from("transcripts")
      .select(
        `episode_id, text,
         episode:episodes!transcripts_episode_id_fkey!inner (
           published_at,
           channel:channels!episodes_channel_id_fkey!inner ( id, name, active )
         )`,
      )
      .eq("episode.channel.active", true)
      .gte("episode.published_at", startISO)
      .lt("episode.published_at", endISO)
      .order("episode_id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`pullWindow: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      if (r.text) { onDoc(extractEntities(r.text), r.episode.channel.id, r.episode.channel.name); docs++; }
    }
  }
  return docs;
}

async function main() {
  const now = Date.now();
  const recentStart = new Date(now - RECENT_DAYS * DAY).toISOString();
  const baseStart = new Date(now - (RECENT_DAYS + BASELINE_DAYS) * DAY).toISOString();

  console.log(`Extracting entities — recent window (last ${RECENT_DAYS}d)…`);
  const recentCount = new Map<string, number>();
  const recentChans = new Map<string, Set<string>>();
  const recentDocs = await pullWindow(recentStart, new Date(now).toISOString(), (ents, ch, chName) => {
    for (const [e, c] of ents) {
      if (chName.toLowerCase().includes(e)) continue; // skip show self-mentions
      recentCount.set(e, (recentCount.get(e) ?? 0) + c);
      let s = recentChans.get(e); if (!s) { s = new Set(); recentChans.set(e, s); }
      s.add(ch);
    }
  });
  const candidates = new Set<string>();
  for (const [e, chans] of recentChans) if (chans.size >= MIN_CHANNELS) candidates.add(e);
  console.log(`  ${recentDocs} docs · ${recentCount.size.toLocaleString()} unique entities · ${candidates.size.toLocaleString()} candidates (≥${MIN_CHANNELS} channels)`);

  console.log(`Extracting entities — baseline window (prior ${BASELINE_DAYS}d)…`);
  const baseCount = new Map<string, number>();
  const baseDocs = await pullWindow(baseStart, recentStart, (ents) => {
    for (const e of ents.keys()) if (candidates.has(e)) baseCount.set(e, (baseCount.get(e) ?? 0) + 1);
  });
  console.log(`  ${baseDocs} baseline docs\n`);

  const scored = [...candidates].map((e) => {
    const chans = recentChans.get(e)!.size;
    const rRate = chans / RECENT_DAYS;
    const bRate = (baseCount.get(e) ?? 0) / BASELINE_DAYS;
    const burst = rRate / (bRate + 0.15);
    return { e, chans, recent: recentCount.get(e) ?? 0, base: baseCount.get(e) ?? 0, burst, score: burst * Math.log2(chans + 1) };
  }).sort((a, b) => b.score - a.score);

  console.log(`TOP ${TOP_N} BURSTING ENTITIES (recent ${RECENT_DAYS}d vs prior ${BASELINE_DAYS}d, ≥${MIN_CHANNELS} channels)`);
  console.log(`${"entity".padEnd(34)} chans  recent  base  burst×`);
  console.log("─".repeat(64));
  for (const s of scored.slice(0, TOP_N)) {
    console.log(`${s.e.slice(0, 33).padEnd(34)} ${String(s.chans).padStart(4)}  ${String(s.recent).padStart(6)}  ${String(s.base).padStart(4)}  ${s.burst.toFixed(1)}`);
  }

  const probes = ["kristen welker", "meet the press", "graham platner", "donald trump", "israel", "welker"];
  console.log(`\nTARGETED readout:`);
  for (const p of probes) {
    console.log(`  ${p.padEnd(20)} → channels ${recentChans.get(p)?.size ?? 0}, recent ${recentCount.get(p) ?? 0}, baseline ${baseCount.get(p) ?? "(not candidate)"}`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
