/**
 * v1.2 stance-stage AGGREGATE-IMPACT eval. The decision is not "what's the stance
 * precision" but "does attribution-correction actually MOVE the per-channel,
 * per-issue score the beta testers validate?" If strong-stance channels barely
 * move and near-neutral ones shift only a little, the aggregate is robust and
 * this is a rabbit hole. If scores swing or flip sign, it's a real issue.
 *
 * For each chosen (channel, issue) pair, take its REAL scored mentions
 * (production classifications + sentiment_scores), run the v1.2 stance stage over
 * each quote + transcript context, and recompute the pair score under:
 *   - v1     : all mentions at face value (current production behavior)
 *   - exclude: drop "opposing" and "report" (keep only the show's own positions)
 *   - flip   : negate sentiment for "opposing" (host holds the opposite), drop "report"
 * Score = clamp(2 * Σ(intensity*sentiment)/Σ(intensity), -10, 10) - reachFactor
 * cancels within one channel (see weightedLean in aggregate.ts).
 *
 * Offline: writes NOTHING to production. Output under eval-stance-impact/
 * (gitignored), resumable (stance cached per score id).
 *
 * Run:  npx tsx scripts/eval-stance-impact.ts [--smoke]
 */
import "./_load-env";
import fs from "fs";
import path from "path";
import { createServiceClient } from "@/lib/db";
import { classifyMentionStance, type Attribution } from "@/modules/classify/stance";
import { mapPool } from "@/lib/concurrency";

const SMOKE = process.argv.includes("--smoke");
const PAIRS: { channel: string; issue: string }[] = [
  { channel: "The Young Turks", issue: "israel-gaza" },        // strong indep left
  { channel: "MeidasTouch Network", issue: "trump-gop" },      // strong indep left
  { channel: "Fox News", issue: "iran-conflict" },             // strong right
  { channel: "Commentary Magazine Podcast", issue: "iran-conflict" }, // right podcast (debate/quote-heavy)
  { channel: "Breaking Points", issue: "iran-conflict" },      // mixed indep (interview-heavy)
  { channel: "The Hill", issue: "iran-conflict" },             // near-neutral legacy
  { channel: "Al Jazeera English", issue: "iran-conflict" },   // near-neutral legacy (reporting)
  { channel: "BBC News", issue: "iran-conflict" },             // near-neutral legacy news
  { channel: "Bloomberg Television", issue: "iran-conflict" }, // near-neutral legacy
  { channel: "Democracy Now!", issue: "immigration" },         // strong indep left
  { channel: "Legal AF", issue: "justice-system" },            // mixed indep
  { channel: "Brian Tyler Cohen", issue: "election-integrity" }, // strong indep left
];

const MAX_PER_PAIR = SMOKE ? 4 : 40;
const WINDOW_DAYS = 60;
const CONTEXT_RADIUS = 1500;
const CONCURRENCY = 6;

const OUT = path.join(process.cwd(), "eval-stance-impact");
const RES = path.join(OUT, "stance");

interface Mention {
  scoreId: string;
  sentiment: number;
  intensity: number;
  quote: string;
  episodeId: string;
}
interface StanceRow extends Mention { attribution: Attribution; confidence: number; reason: string }

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

function score(rows: { sentiment: number; intensity: number }[]): number {
  let ws = 0, w = 0;
  for (const r of rows) { ws += r.intensity * r.sentiment; w += r.intensity; }
  return w > 0 ? clamp((2 * ws) / w, -10, 10) : 0;
}

function contextWindow(text: string, quote: string): string {
  let idx = text.indexOf(quote);
  if (idx < 0) { const p = quote.slice(0, 50).trim(); if (p) idx = text.indexOf(p); }
  if (idx < 0) return quote;
  const s = Math.max(0, idx - CONTEXT_RADIUS), e = Math.min(text.length, idx + quote.length + CONTEXT_RADIUS);
  return (s > 0 ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "");
}

async function main() {
  fs.mkdirSync(RES, { recursive: true });
  const db = createServiceClient();
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  const issueNames = new Map<string, string>();
  {
    const { data } = await db.from("issues").select("slug, name");
    for (const i of (data as any[]) || []) issueNames.set(i.slug, i.name);
  }

  // Fetch each pair's channel meta + its mentions.
  const pairData: {
    channel: string; issue: string; issueName: string; lean: "L" | "M" | "R"; cohort: string | null;
    mentions: Mention[];
  }[] = [];
  const transcriptNeed = new Set<string>();

  for (const p of PAIRS) {
    const { data: ch } = await db
      .from("channels")
      .select("id, name, political_lean, cohort")
      .eq("name", p.channel)
      .maybeSingle();
    if (!ch) { console.log(`  ! channel not found: ${p.channel}`); continue; }

    const { data, error } = await db
      .from("sentiment_scores")
      .select(
        `id, sentiment, intensity,
         classification:classifications!sentiment_scores_classification_id_fkey!inner (
           supporting_quote, issue_slug,
           episode:episodes!classifications_episode_id_fkey!inner ( id, channel_id, published_at )
         )`,
      )
      .eq("classification.issue_slug", p.issue)
      .eq("classification.episode.channel_id", (ch as any).id)
      .gte("classification.episode.published_at", cutoff)
      .order("id", { ascending: true })
      .limit(MAX_PER_PAIR);
    if (error) { console.log(`  ! mentions ${p.channel}/${p.issue}: ${error.message}`); continue; }

    const mentions: Mention[] = (data as any[]).map((r) => ({
      scoreId: r.id,
      sentiment: Number(r.sentiment),
      intensity: Number(r.intensity),
      quote: r.classification?.supporting_quote || "",
      episodeId: r.classification?.episode?.id,
    })).filter((m) => m.quote && m.episodeId);
    mentions.forEach((m) => transcriptNeed.add(m.episodeId));
    pairData.push({
      channel: p.channel, issue: p.issue, issueName: issueNames.get(p.issue) || p.issue,
      lean: (ch as any).political_lean, cohort: (ch as any).cohort, mentions,
    });
  }

  console.log(`Pairs: ${pairData.length}, mentions: ${pairData.reduce((a, p) => a + p.mentions.length, 0)}, ` +
    `transcripts to fetch: ${transcriptNeed.size}`);

  // Fetch transcripts (cache in memory).
  const transcripts = new Map<string, string>();
  await mapPool([...transcriptNeed], CONCURRENCY, async (epId) => {
    const { data } = await db.from("transcripts").select("text").eq("episode_id", epId).maybeSingle();
    if (data?.text) transcripts.set(epId, data.text);
  });

  // Run v1.2 stance over each mention (cached per score id, resumable).
  const all: { pair: typeof pairData[number]; rows: StanceRow[] }[] = [];
  for (const pair of pairData) {
    const rows: StanceRow[] = [];
    await mapPool(pair.mentions, CONCURRENCY, async (m) => {
      const cacheP = path.join(RES, `${m.scoreId}.json`);
      let st: { attribution: Attribution; confidence: number; reason: string };
      if (fs.existsSync(cacheP)) {
        st = JSON.parse(fs.readFileSync(cacheP, "utf8"));
      } else {
        const text = transcripts.get(m.episodeId) || "";
        const ctx = text ? contextWindow(text, m.quote) : m.quote;
        const r = await classifyMentionStance({
          quote: m.quote, context: ctx, issueName: pair.issueName,
          channelName: pair.channel, politicalLean: pair.lean,
        });
        st = { attribution: r.attribution, confidence: r.confidence, reason: r.reason };
        fs.writeFileSync(cacheP, JSON.stringify(st));
      }
      rows.push({ ...m, ...st });
    });
    all.push({ pair, rows });
    const n = rows.length, opp = rows.filter((r) => r.attribution === "opposing").length,
      rep = rows.filter((r) => r.attribution === "report").length;
    console.log(`  ${pair.channel.slice(0, 20).padEnd(20)} ${pair.issue.padEnd(18)} n=${n} own=${n - opp - rep} opp=${opp} rep=${rep}`);
  }

  // Recompute scores + report.
  const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);
  const lines: string[] = [];
  lines.push(`# v1.2 stance-stage — AGGREGATE IMPACT on per-channel-per-issue scores`);
  lines.push(``);
  lines.push(`Score = clamp(2·Σ(int·sent)/Σ(int), -10, +10). exclude = drop "opposing". flip = negate "opposing" sentiment. "own" and "report" are kept as-is (reports are neutral/near-zero - dropping them is a scoring question, not an attribution correction).`);
  lines.push(``);
  lines.push(`| channel | issue | n | opp | rep | v1 | exclude (Δ) | flip (Δ) | sign flip? |`);
  lines.push(`|---|---|--:|--:|--:|--:|--:|--:|:--:|`);
  let maxAbsFlip = 0, sumAbsFlip = 0, moved1 = 0, signFlips = 0, totalOpp = 0, totalRep = 0, totalN = 0;
  for (const { pair, rows } of all) {
    // Correct ONLY "opposing" (the genuine attribution error). "own" and
    // "report" stay as-is - dropping reports would distort reporting-heavy
    // channels without being an attribution fix.
    const keepExclude = rows.filter((r) => r.attribution !== "opposing");
    const keepFlip = rows.map((r) => r.attribution === "opposing" ? { ...r, sentiment: -r.sentiment } : r);
    const v1 = score(rows), ex = score(keepExclude), fl = score(keepFlip);
    const dEx = ex - v1, dFl = fl - v1;
    const signFlip = Math.sign(v1) !== 0 && Math.sign(fl) !== 0 && Math.sign(v1) !== Math.sign(fl);
    const opp = rows.filter((r) => r.attribution === "opposing").length;
    const rep = rows.filter((r) => r.attribution === "report").length;
    totalOpp += opp; totalRep += rep; totalN += rows.length;
    maxAbsFlip = Math.max(maxAbsFlip, Math.abs(dFl)); sumAbsFlip += Math.abs(dFl);
    if (Math.abs(dFl) >= 1) moved1++;
    if (signFlip) signFlips++;
    lines.push(`| ${pair.channel} | ${pair.issue} | ${rows.length} | ${opp} | ${rep} | ${fmt(v1)} | ${fmt(ex)} (${fmt(dEx)}) | ${fmt(fl)} (${fmt(dFl)}) | ${signFlip ? "**YES**" : "no"} |`);
  }
  lines.push(``);
  lines.push(`## Headline`);
  lines.push(`- Attribution prevalence across these pairs: opposing ${(totalOpp / totalN * 100).toFixed(1)}%, report ${(totalRep / totalN * 100).toFixed(1)}% (own ${(100 - (totalOpp + totalRep) / totalN * 100).toFixed(1)}%).`);
  lines.push(`- Aggregate movement under FLIP: mean |Δ| = ${(sumAbsFlip / all.length).toFixed(2)} pts, max |Δ| = ${maxAbsFlip.toFixed(2)} pts.`);
  lines.push(`- Pairs that moved ≥ 1.0 pt: ${moved1}/${all.length}. Pairs that FLIPPED L↔R sign: ${signFlips}/${all.length}.`);
  lines.push(``);
  lines.push(`Read: small mean |Δ| and few/no sign flips ⇒ the per-channel-per-issue aggregate is robust to attribution (rabbit hole). Large |Δ| or sign flips ⇒ real issue worth wiring.`);

  fs.writeFileSync(path.join(OUT, "IMPACT.md"), lines.join("\n"));

  // Spot-check queue: the "opposing" calls (the ones that would change scoring).
  const q: string[] = [`# v1.2 "opposing" calls — spot check (these are what move the score)`, ``];
  let k = 0;
  for (const { pair, rows } of all) {
    for (const r of rows.filter((x) => x.attribution === "opposing")) {
      k++;
      const text = transcripts.get(r.episodeId) || "";
      q.push(`---`);
      q.push(`### ${k}. ${pair.channel} · ${pair.issue} · sent=${r.sentiment} int=${r.intensity} conf=${r.confidence}`);
      q.push(`reason: ${r.reason}`);
      q.push(`quote: "${r.quote}"`);
      q.push(`context:`); q.push("```"); q.push(text ? contextWindow(text, r.quote) : "(no transcript)"); q.push("```"); q.push(``);
    }
  }
  fs.writeFileSync(path.join(OUT, "opposing-spotcheck.md"), q.join("\n"));

  console.log(`\n${"─".repeat(60)}`);
  console.log(lines.join("\n"));
  console.log(`\nWrote eval-stance-impact/IMPACT.md and opposing-spotcheck.md (${k} opposing calls).`);
}

main().catch((e) => { console.error("\nFATAL:", e); process.exit(1); });
