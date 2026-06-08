/**
 * READ-ONLY proof-of-concept: can we detect a breakout EVENT (not a standing
 * issue) from transcript text via cheap n-gram burst detection? Motivating
 * case: the weekend Meet-the-Press walkout.
 *
 * Method (Stage 1 of the proposed funnel — no embeddings, no LLM):
 *   1. Recent window (last RECENT_DAYS): tokenize transcripts → 2/3-grams,
 *      track per-gram total count + set of distinct channels.
 *   2. Keep candidates seen in ≥ MIN_CHANNELS distinct channels (the
 *      cross-channel synchrony signal that separates events from one-show
 *      hobbyhorses and per-channel ad boilerplate).
 *   3. Baseline window (prior BASELINE_DAYS): tally ONLY those candidates.
 *   4. burst = recent_per_day_rate / (baseline_per_day_rate + smoothing).
 *      Rank by burst × log(distinct_channels).
 *
 * Reports the top bursting phrases + a targeted readout for the MTP event.
 * No DB writes. Run: npx tsx scripts/probe-event-burst.ts
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";

const RECENT_DAYS = 3;
const BASELINE_DAYS = 21;
const MIN_CHANNELS = 5;       // breadth floor — the synchrony signal
const TOP_N = 40;
const DAY = 86_400_000;

const STOP = new Set(
  ("a an and the of to in on for with at by from is are was were be been being it its this that these those " +
   "he she they them his her their we you i me my our your as so but or not no yes if then than too very just " +
   "what when where who how why which there here about over under out up down into more most some any all can " +
   "will would could should may might do does did done have has had get got go going gonna want know think " +
   "like right now today thing things people going say said says talk talking going know mean really actually " +
   "one two three first lot kind sort going back come came going look looking thank thanks welcome show " +
   "going dont didnt cant im youre were thats whats hes shes were theyre going").split(/\s+/));

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);
}

function* ngrams(tokens: string[]): Generator<string> {
  for (let i = 0; i < tokens.length; i++) {
    // 2-grams and 3-grams; skip grams that are entirely stopwords/filler
    for (const n of [2, 3]) {
      if (i + n > tokens.length) continue;
      const slice = tokens.slice(i, i + n);
      if (slice.every((t) => STOP.has(t) || t.length < 3)) continue;
      if (STOP.has(slice[0]) || STOP.has(slice[n - 1])) continue; // trim stopword edges
      yield slice.join(" ");
    }
  }
}

async function pullWindow(
  startISO: string,
  endISO: string,
  onDoc: (text: string, channelId: string) => void,
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
           channel:channels!episodes_channel_id_fkey!inner ( id, active )
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
      if (r.text) { onDoc(r.text, r.episode.channel.id); docs++; }
    }
  }
  return docs;
}

async function main() {
  const now = Date.now();
  const recentStart = new Date(now - RECENT_DAYS * DAY).toISOString();
  const baseStart = new Date(now - (RECENT_DAYS + BASELINE_DAYS) * DAY).toISOString();
  const baseEnd = recentStart;

  // ── Stage 1: recent n-grams + channel breadth ──
  console.log(`Pulling recent window (last ${RECENT_DAYS}d)…`);
  const recentCount = new Map<string, number>();
  const recentChans = new Map<string, Set<string>>();
  const recentDocs = await pullWindow(recentStart, new Date(now).toISOString(), (text, ch) => {
    const seenInDoc = new Set<string>();
    for (const g of ngrams(tokenize(text))) {
      recentCount.set(g, (recentCount.get(g) ?? 0) + 1);
      if (!seenInDoc.has(g)) {
        seenInDoc.add(g);
        let s = recentChans.get(g); if (!s) { s = new Set(); recentChans.set(g, s); }
        s.add(ch);
      }
    }
  });

  // candidates: cross-channel breadth filter
  const candidates = new Set<string>();
  for (const [g, chans] of recentChans) if (chans.size >= MIN_CHANNELS) candidates.add(g);
  console.log(`  ${recentDocs} docs · ${recentCount.size.toLocaleString()} unique n-grams · ${candidates.size.toLocaleString()} candidates (≥${MIN_CHANNELS} channels)`);

  // ── Stage 1b: baseline tally for candidates only ──
  console.log(`Pulling baseline window (prior ${BASELINE_DAYS}d), tallying candidates…`);
  const baseCount = new Map<string, number>();
  const baseDocs = await pullWindow(baseStart, baseEnd, (text) => {
    const seen = new Set<string>();
    for (const g of ngrams(tokenize(text))) {
      if (!candidates.has(g) || seen.has(g)) continue;
      seen.add(g); // doc-frequency style; count once per doc to damp repetition
      baseCount.set(g, (baseCount.get(g) ?? 0) + 1);
    }
  });
  console.log(`  ${baseDocs} baseline docs\n`);

  // ── Stage 1c: burst score ──
  const recentPerDay = (g: string) => (recentChans.get(g)?.size ?? 0); // doc/channel breadth as recent rate
  const scored = [...candidates].map((g) => {
    const chans = recentChans.get(g)!.size;
    const rRate = chans / RECENT_DAYS;
    const bRate = (baseCount.get(g) ?? 0) / BASELINE_DAYS;
    const burst = rRate / (bRate + 0.15); // smoothing: ~zero baseline → high burst
    return { g, chans, recent: recentCount.get(g) ?? 0, base: baseCount.get(g) ?? 0, burst, score: burst * Math.log2(chans + 1) };
  }).sort((a, b) => b.score - a.score);

  console.log(`TOP ${TOP_N} BURSTING PHRASES (recent ${RECENT_DAYS}d vs prior ${BASELINE_DAYS}d)`);
  console.log(`${"phrase".padEnd(32)} chans  recent  base  burst×`);
  console.log("─".repeat(64));
  for (const s of scored.slice(0, TOP_N)) {
    console.log(`${s.g.slice(0, 31).padEnd(32)} ${String(s.chans).padStart(4)}  ${String(s.recent).padStart(6)}  ${String(s.base).padStart(4)}  ${s.burst.toFixed(1)}`);
  }

  // ── Targeted readout: the MTP event ──
  const probes = ["meet the press", "walked out", "walk out", "stormed off", "kristen welker", "the interview", "left the interview", "ended the interview", "trump walked"];
  console.log(`\nTARGETED — Meet-the-Press walkout terms:`);
  for (const p of probes) {
    const chans = recentChans.get(p)?.size ?? 0;
    const rec = recentCount.get(p) ?? 0;
    const base = baseCount.get(p) ?? "(not a candidate)";
    console.log(`  "${p}".padEnd → channels ${chans}, recent ${rec}, baseline ${base}`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
