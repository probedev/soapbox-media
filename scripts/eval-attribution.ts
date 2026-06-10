/**
 * Attribution eval battery (v1 vs v1.1 classify). Offline experiment - writes
 * NOTHING to production tables (classifications / sentiment_scores / discovery).
 * All output goes under eval-attribution/ (gitignored).
 *
 * Design (per the advisor + [[gold-set-strategy]]):
 *  - Two slices, analyzed SEPARATELY:
 *      R (random, ~60): representative -> PREVALENCE of non-endorse + easy-case
 *        extraction regression. This is the headline number.
 *      H (cue-enriched, ~30): over-represents rebuttal contexts -> more delta
 *        cases to adjudicate; do NOT read prevalence off this slice.
 *  - v1.1 is a MINIMAL diff of v1 (same extraction, only adds the stance
 *    annotation), so easy-case quotes should match v1 (baseline v1 ≡ all-endorse).
 *  - The DELTA cases (v1.1 stance = rebuts/reports) are emitted as a human
 *    adjudication queue (quote + wide context window). That human sample is the
 *    precision denominator. An Opus refute-judge only TRIAGES (prompted to
 *    refute the non-endorse call) - never reported as ground-truth accuracy.
 *  - Resumable: one result file per transcript; re-running skips finished ones.
 *
 * Pre-registered go/no-go (written to SUMMARY.md before results are read):
 *  - GO (wire Option B schema): prevalence_R >= 8% AND human-confirmed precision
 *    on rebut/report >= 80% AND easy-case quote-overlap >= 90%.
 *  - NO-GO (skip schema; do Option A or nothing): prevalence_R < 3%.
 *  - Between / split by provider: judgment call (e.g. YouTube-only if podcasts,
 *    which have no turn markers, are coin-flip).
 *
 * Run:   npx tsx scripts/eval-attribution.ts            (full ~90)
 *        npx tsx scripts/eval-attribution.ts --smoke     (4 transcripts)
 *        npx tsx scripts/eval-attribution.ts --no-judge  (skip Opus triage)
 *        npx tsx scripts/eval-attribution.ts --report    (re-aggregate only)
 */
import "./_load-env";
import fs from "fs";
import path from "path";
import { createServiceClient } from "@/lib/db";
import { classifyTranscript, type IssueDef, type ClassifyInput } from "@/modules/classify";
import { classifyTranscriptV11 } from "@/modules/classify/experimental";
import { getAnthropicClient, extractJson } from "@/lib/anthropic";
import { mapPool } from "@/lib/concurrency";

const SMOKE = process.argv.includes("--smoke");
const RUN_JUDGE = !process.argv.includes("--no-judge");
const REPORT_ONLY = process.argv.includes("--report");

const RANDOM_YT = SMOKE ? 1 : 36;
const RANDOM_POD = SMOKE ? 1 : 24;
const HARD_N = SMOKE ? 2 : 30;
// Noise floor: run v1 a SECOND time on the first N random transcripts, so the
// regression check can tell prompt-churn from LLM sampling variance.
const NOISE_FLOOR_N = SMOKE ? 1 : 20;
const HARD_CAP = 100; // safety: never process more transcripts than this
const CONCURRENCY = 5;
const JUDGE_MODEL = "claude-opus-4-8";
const CONTEXT_RADIUS = 1600;

const OUT_DIR = path.join(process.cwd(), "eval-attribution");
const RESULTS_DIR = path.join(OUT_DIR, "results");

interface SampleItem {
  id: string;
  slice: "R" | "H";
  provider: string;
  channel: string;
  lean: "L" | "M" | "R";
  cohort: string | null;
  title: string;
  published_at: string;
}

interface Mention { issue_slug: string; supporting_quote: string }
interface MentionV11 extends Mention { stance: "endorses" | "rebuts" | "reports" }
interface JudgeVerdict { true_stance: string; label_holds: boolean; confidence: number; reason: string }
interface DeltaCase {
  issue_slug: string;
  quote: string;
  stance: "rebuts" | "reports";
  context: string;
  judge?: JudgeVerdict | { error: string };
}
interface TranscriptResult {
  item: SampleItem;
  v1: Mention[];
  /** Second v1 pass on a subset of R, for the sampling-noise floor. */
  v1b?: Mention[];
  v11: MentionV11[];
  deltas: DeltaCase[];
  v1_error?: string;
  v11_error?: string;
}

function ensureDirs() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function resultPath(id: string): string {
  return path.join(RESULTS_DIR, `${id}.json`);
}

// ── selection ──────────────────────────────────────────────────────────────

// Apostrophe-free (they go into a PostgREST .or() filter string).
const CUES = [
  "they say", "they claim", "the left", "the right", "watch this",
  "listen to", "play the", "so-called", "supposedly", "the other side",
];

async function selectSample(db: ReturnType<typeof createServiceClient>): Promise<SampleItem[]> {
  const samplePath = path.join(OUT_DIR, "sample.json");
  if (fs.existsSync(samplePath) && !SMOKE) {
    return JSON.parse(fs.readFileSync(samplePath, "utf8"));
  }

  const meta = `e.id, e.title, e.published_at, t.provider,
    ch.name AS channel, ch.political_lean AS lean, ch.cohort`;
  const base = `FROM transcripts t
    JOIN episodes e ON e.id = t.episode_id
    JOIN channels ch ON ch.id = e.channel_id
    WHERE e.published_at > now() - interval '45 days' AND length(t.text) > 1000`;
  // Stable pseudo-random ordering so the sample is reproducible across resumes.
  const salt = "soapbox-attr-eval-1";

  // Supabase JS lacks md5 ordering, so over-fetch by provider/cue filter and
  // shuffle deterministically client-side via a stable hash of (id + salt).
  const fetchBy = async (
    provider: string | null,
    cueFilter: boolean,
    limit: number,
    excludeIds: Set<string>,
  ): Promise<SampleItem[]> => {
    let q = db
      .from("transcripts")
      .select(
        `provider,
         episode:episodes!transcripts_episode_id_fkey!inner (
           id, title, published_at,
           channel:channels!episodes_channel_id_fkey!inner ( name, political_lean, cohort )
         )`,
      )
      .gte("episode.published_at", new Date(Date.now() - 45 * 86400_000).toISOString());
    if (provider) q = q.eq("provider", provider);
    if (cueFilter) {
      const ors = CUES.map((c) => `text.ilike.%${c}%`).join(",");
      q = q.or(ors);
    }
    const { data, error } = await q.limit(800);
    if (error) throw new Error(`select(${provider}/${cueFilter}): ${error.message}`);
    const rows: SampleItem[] = (data as any[])
      .map((r) => {
        const e = r.episode;
        const ch = e?.channel;
        if (!e || !ch) return null;
        return {
          id: e.id,
          slice: cueFilter ? ("H" as const) : ("R" as const),
          provider: r.provider,
          channel: ch.name,
          lean: ch.political_lean,
          cohort: ch.cohort,
          title: e.title || "",
          published_at: e.published_at,
        };
      })
      .filter((x): x is SampleItem => !!x && !excludeIds.has(x.id));
    // Deterministic shuffle by a stable hash of (id + salt).
    rows.sort((a, b) => hash(a.id + salt) - hash(b.id + salt));
    return rows.slice(0, limit);
  };

  const picked: SampleItem[] = [];
  const seen = new Set<string>();
  const add = (xs: SampleItem[]) => {
    for (const x of xs) if (!seen.has(x.id)) { seen.add(x.id); picked.push(x); }
  };

  add(await fetchBy("youtube_captions", false, RANDOM_YT, seen));
  add(await fetchBy("podscan", false, RANDOM_POD, seen));
  add(await fetchBy(null, true, HARD_N, seen)); // cue-enriched, mixed providers

  const capped = picked.slice(0, HARD_CAP);
  fs.writeFileSync(samplePath, JSON.stringify(capped, null, 2));
  return capped;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function contextWindow(text: string, quote: string): string {
  let idx = text.indexOf(quote);
  if (idx < 0) {
    const probe = quote.slice(0, 50).trim();
    if (probe) idx = text.indexOf(probe);
  }
  if (idx < 0) return quote;
  const start = Math.max(0, idx - CONTEXT_RADIUS);
  const end = Math.min(text.length, idx + quote.length + CONTEXT_RADIUS);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// ── refute-judge (triage only) ───────────────────────────────────────────────

async function judgeDelta(issueName: string, d: DeltaCase): Promise<JudgeVerdict | { error: string }> {
  try {
    const client = getAnthropicClient();
    const prompt = `You are AUDITING a stance label produced by a classifier on a US political show transcript. The classifier labeled the quote below as "${d.stance}" - meaning the HOST does NOT endorse the position (they rebut it, or merely report it neutrally).

Your job is to REFUTE that label: look hard for evidence that the host actually ENDORSES / agrees with the position in the quote. The transcripts have no speaker labels; in YouTube captions ">>" marks a change of speaker.

ISSUE: ${issueName}
QUOTE: "${d.quote}"

SURROUNDING CONTEXT (excerpt):
${d.context}

Return ONLY JSON: {"true_stance": "endorses"|"rebuts"|"reports", "label_holds": true|false, "confidence": 0.0-1.0, "reason": "one sentence"}
- label_holds = whether the original non-endorse label ("${d.stance}") is correct.
- Default to label_holds=false (assume endorses) UNLESS the context clearly shows the host rebutting or neutrally reporting.`;
    const resp = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const tb = resp.content.find((b) => b.type === "text");
    const raw = tb && tb.type === "text" ? tb.text : "";
    const parsed = extractJson<JudgeVerdict>(raw);
    if (!parsed || typeof parsed.label_holds !== "boolean") return { error: `unparseable: ${raw.slice(0, 120)}` };
    return parsed;
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

// ── per-transcript run ───────────────────────────────────────────────────────

async function processOne(
  db: ReturnType<typeof createServiceClient>,
  issues: IssueDef[],
  item: SampleItem,
  runV1b: boolean,
): Promise<void> {
  if (fs.existsSync(resultPath(item.id))) return; // resumable

  const { data: tRow, error: tErr } = await db
    .from("transcripts")
    .select("text")
    .eq("episode_id", item.id)
    .maybeSingle();
  if (tErr || !tRow?.text) {
    fs.writeFileSync(resultPath(item.id), JSON.stringify({ item, v1: [], v11: [], deltas: [], v1_error: "transcript missing" }, null, 2));
    return;
  }
  const text: string = tRow.text;
  const input: ClassifyInput = {
    transcript: text,
    channelName: item.channel,
    politicalLean: item.lean,
    episodeTitle: item.title,
    publishedAt: item.published_at,
    issues,
  };
  const issueName = (slug: string) => issues.find((i) => i.slug === slug)?.name || slug;

  const out: TranscriptResult = { item, v1: [], v11: [], deltas: [] };
  try {
    const r1 = await classifyTranscript(input);
    out.v1 = r1.mentions;
  } catch (e: any) { out.v1_error = e?.message || String(e); }
  if (runV1b) {
    try {
      const r1b = await classifyTranscript(input);
      out.v1b = r1b.mentions;
    } catch { /* noise-floor pass is best-effort */ }
  }
  try {
    const r11 = await classifyTranscriptV11(input);
    out.v11 = r11.mentions;
    for (const m of r11.mentions) {
      if (m.stance === "rebuts" || m.stance === "reports") {
        const d: DeltaCase = {
          issue_slug: m.issue_slug,
          quote: m.supporting_quote,
          stance: m.stance,
          context: contextWindow(text, m.supporting_quote),
        };
        if (RUN_JUDGE) d.judge = await judgeDelta(issueName(m.issue_slug), d);
        out.deltas.push(d);
      }
    }
  } catch (e: any) { out.v11_error = e?.message || String(e); }

  fs.writeFileSync(resultPath(item.id), JSON.stringify(out, null, 2));
  console.log(
    `  [${item.slice}/${item.provider.slice(0, 3)}] ${item.channel.slice(0, 22).padEnd(22)} ` +
    `v1=${out.v1.length} v1.1=${out.v11.length} delta=${out.deltas.length}` +
    (out.v1_error || out.v11_error ? " ERR" : ""),
  );
}

// ── aggregation / report ─────────────────────────────────────────────────────

function normFull(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Two quotes "match" if they're the same issue and cover the same span - one's
 *  normalized text contains a ~40-char core of the other (tolerates different
 *  quote boundaries on the same discussion). */
function quotesMatch(a: string, b: string): boolean {
  const na = normFull(a), nb = normFull(b);
  if (na.length < 24 || nb.length < 24) return na === nb;
  const core = (s: string) => s.slice(Math.max(0, (s.length >> 1) - 20), (s.length >> 1) + 20);
  return na.includes(core(nb)) || nb.includes(core(na)) || na.includes(nb.slice(0, 40)) || nb.includes(na.slice(0, 40));
}

/** Fraction of `cand` mentions that match some `ref` mention (same issue + span). */
function overlap(cand: Mention[], ref: Mention[]): { matched: number; total: number } {
  let matched = 0;
  for (const m of cand) {
    if (ref.some((r) => r.issue_slug === m.issue_slug && quotesMatch(m.supporting_quote, r.supporting_quote))) matched++;
  }
  return { matched, total: cand.length };
}

function aggregate(sample: SampleItem[]) {
  const results: TranscriptResult[] = [];
  for (const it of sample) {
    const p = resultPath(it.id);
    if (fs.existsSync(p)) results.push(JSON.parse(fs.readFileSync(p, "utf8")));
  }

  const R = results.filter((r) => r.item.slice === "R");
  const H = results.filter((r) => r.item.slice === "H");

  // Prevalence (slice R only), overall + by provider.
  const prevalence = (rows: TranscriptResult[]) => {
    let endorses = 0, rebuts = 0, reports = 0;
    for (const r of rows) for (const m of r.v11) {
      if (m.stance === "rebuts") rebuts++; else if (m.stance === "reports") reports++; else endorses++;
    }
    const total = endorses + rebuts + reports;
    return { total, endorses, rebuts, reports, nonEndorsePct: total ? ((rebuts + reports) / total) * 100 : 0 };
  };
  const prevAll = prevalence(R);
  const prevYT = prevalence(R.filter((r) => r.item.provider === "youtube_captions"));
  const prevPod = prevalence(R.filter((r) => r.item.provider === "podscan"));

  // Easy-case extraction regression (slice R). v1.1 is meant to ADD non-endorse
  // mentions, not change the endorse ones - so the clean check is: do v1.1's
  // ENDORSE mentions still match v1? Compare against the noise floor (v1 vs a
  // second v1 pass) so we can tell prompt-churn from LLM sampling variance.
  let v1Count = 0, v11Count = 0, v11EndorseMatched = 0, v11EndorseTotal = 0;
  for (const r of R) {
    v1Count += r.v1.length;
    v11Count += r.v11.length;
    const endorse = r.v11.filter((m) => m.stance === "endorses");
    const o = overlap(endorse, r.v1);
    v11EndorseMatched += o.matched;
    v11EndorseTotal += o.total;
  }
  const endorseOverlapPct = v11EndorseTotal ? (v11EndorseMatched / v11EndorseTotal) * 100 : 0;

  // Noise floor: v1 vs v1b on the subset that got a second pass.
  let nfMatched = 0, nfTotal = 0, nfV1 = 0, nfV1b = 0, nfN = 0;
  for (const r of R) {
    if (!r.v1b) continue;
    nfN++;
    nfV1 += r.v1.length;
    nfV1b += r.v1b.length;
    const o = overlap(r.v1b, r.v1);
    nfMatched += o.matched;
    nfTotal += o.total;
  }
  const noiseFloorPct = nfTotal ? (nfMatched / nfTotal) * 100 : 0;

  // Judge triage over ALL delta cases (R + H), by provider.
  const allDeltas = results.flatMap((r) => r.deltas.map((d) => ({ d, provider: r.item.provider, slice: r.item.slice })));
  const judged = allDeltas.filter((x) => x.d.judge && !("error" in (x.d.judge as any)));
  const judgeHolds = (rows: typeof judged) =>
    rows.length ? (rows.filter((x) => (x.d.judge as JudgeVerdict).label_holds).length / rows.length) * 100 : 0;

  // Pre-registered thresholds.
  const T = { prevalenceGo: 8, prevalenceNoGo: 3, precisionGo: 80, overlapGo: 90 };

  const pct = (n: number) => `${n.toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`# Attribution eval (v1 vs v1.1) - SUMMARY`);
  lines.push(``);
  lines.push(`Transcripts processed: ${results.length} (R=${R.length}, H=${H.length}). Judge: ${RUN_JUDGE ? JUDGE_MODEL : "off"}.`);
  lines.push(``);
  lines.push(`## Pre-registered go/no-go (set before results)`);
  lines.push(`- GO (wire Option B): prevalence_R ≥ ${T.prevalenceGo}% AND human precision(rebut+report) ≥ ${T.precisionGo}% AND easy-case overlap ≥ ${T.overlapGo}%.`);
  lines.push(`- NO-GO (skip schema): prevalence_R < ${T.prevalenceNoGo}%.`);
  lines.push(`- Between / coin-flip on podcasts: judgment / provider-split rollout.`);
  lines.push(``);
  lines.push(`## 1. PREVALENCE of non-endorse stance — random slice R (the headline)`);
  lines.push(`| slice | mentions | endorses | rebuts | reports | non-endorse |`);
  lines.push(`|---|---|---|---|---|---|`);
  lines.push(`| R all | ${prevAll.total} | ${prevAll.endorses} | ${prevAll.rebuts} | ${prevAll.reports} | **${pct(prevAll.nonEndorsePct)}** |`);
  lines.push(`| R youtube | ${prevYT.total} | ${prevYT.endorses} | ${prevYT.rebuts} | ${prevYT.reports} | ${pct(prevYT.nonEndorsePct)} |`);
  lines.push(`| R podcast | ${prevPod.total} | ${prevPod.endorses} | ${prevPod.rebuts} | ${prevPod.reports} | ${pct(prevPod.nonEndorsePct)} |`);
  lines.push(``);
  lines.push(`## 2. Easy-case extraction regression — slice R`);
  lines.push(`Mention counts: v1=${v1Count}, v1.1=${v11Count} (v1.1 is meant to add the non-endorse mentions).`);
  lines.push(`- **Easy-case overlap** (v1.1 ENDORSE mentions matching a v1 mention): **${pct(endorseOverlapPct)}**`);
  lines.push(`- **Noise floor** (v1 vs a 2nd v1 pass, n=${nfN}): ${pct(noiseFloorPct)} overlap; counts v1=${nfV1} vs v1b=${nfV1b}.`);
  lines.push(`- Read: if easy-case overlap ≈ noise floor, v1.1 did NOT change endorse extraction (good). If it's well below the floor, the stance prompt caused churn.`);
  lines.push(``);
  lines.push(`## 3. Stance precision — JUDGE TRIAGE ONLY (not ground truth)`);
  lines.push(`Delta cases (v1.1 said rebut/report): ${allDeltas.length} (judged ok: ${judged.length}).`);
  lines.push(`Judge says label holds: all=${pct(judgeHolds(judged))}, ` +
    `youtube=${pct(judgeHolds(judged.filter((x) => x.provider === "youtube_captions")))}, ` +
    `podcast=${pct(judgeHolds(judged.filter((x) => x.provider === "podscan")))}.`);
  lines.push(`> The judge shares the classifier's no-speaker-label limitation - use the adjudication queue (human) as the real precision denominator.`);
  lines.push(``);
  lines.push(`## Next: open eval-attribution/adjudication-queue.md and label each delta case (endorses? rebuts? reports?). That human-labeled precision is what the go/no-go threshold is checked against.`);

  fs.writeFileSync(path.join(OUT_DIR, "SUMMARY.md"), lines.join("\n"));

  // Human adjudication queue (markdown).
  const q: string[] = [`# Adjudication queue — delta cases (v1.1 said rebut/report)`, ``,
    `For each: is the host actually NOT endorsing this? Mark TRUE_STANCE = endorses | rebuts | reports.`, ``];
  allDeltas.forEach((x, i) => {
    const j = x.d.judge as any;
    q.push(`---`);
    q.push(`### ${i + 1}. [${x.slice}/${x.provider}] ${results.find((r) => r.deltas.includes(x.d))?.item.channel ?? ""}`);
    q.push(`- issue: **${x.d.issue_slug}** · v1.1 stance: **${x.d.stance}**` +
      (j && !("error" in j) ? ` · judge: ${j.label_holds ? "holds" : "REFUTED→endorses"} (${j.confidence}) — ${j.reason}` : j ? ` · judge error` : ``));
    q.push(`- quote: "${x.d.quote}"`);
    q.push(`- context:`);
    q.push("```");
    q.push(x.d.context);
    q.push("```");
    q.push(`- TRUE_STANCE: ____`);
    q.push(``);
  });
  fs.writeFileSync(path.join(OUT_DIR, "adjudication-queue.md"), q.join("\n"));
  fs.writeFileSync(path.join(OUT_DIR, "adjudication-queue.json"), JSON.stringify(allDeltas, null, 2));

  console.log(`\n${"─".repeat(60)}`);
  console.log(lines.join("\n"));
  console.log(`\nWrote eval-attribution/SUMMARY.md, adjudication-queue.md (${allDeltas.length} cases), sample.json, results/`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureDirs();
  const db = createServiceClient();

  const { data: issues, error: issuesErr } = await db
    .from("issues")
    .select("slug, name, definition")
    .eq("active", true);
  if (issuesErr || !issues?.length) throw new Error(`load issues: ${issuesErr?.message}`);
  const issuesTyped = issues as IssueDef[];

  const sample = await selectSample(db);
  console.log(`Attribution eval: ${sample.length} transcripts ` +
    `(R=${sample.filter((s) => s.slice === "R").length}, H=${sample.filter((s) => s.slice === "H").length}), ` +
    `${issuesTyped.length} issues, judge=${RUN_JUDGE ? JUDGE_MODEL : "off"}.`);

  // First NOISE_FLOOR_N random transcripts also get a second v1 pass.
  const v1bIds = new Set(
    sample.filter((s) => s.slice === "R").slice(0, NOISE_FLOOR_N).map((s) => s.id),
  );

  if (!REPORT_ONLY) {
    const todo = sample.filter((s) => !fs.existsSync(resultPath(s.id)));
    console.log(`To process: ${todo.length} (${sample.length - todo.length} already done).`);
    await mapPool(todo, CONCURRENCY, (item) => processOne(db, issuesTyped, item, v1bIds.has(item.id)));
  }

  aggregate(sample);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
