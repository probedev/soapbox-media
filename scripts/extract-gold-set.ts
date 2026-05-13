/**
 * Extract a stratified random sample of mentions for independent labeling.
 *
 * Produces two CSVs in `eval/`:
 *   - gold-set-YYYY-MM-DD.csv         — clean labeler-facing file (no model
 *                                       scores, channel name blinded to lean)
 *   - gold-set-YYYY-MM-DD-answers.csv  — internal answer key with the model's
 *                                       scores + real channel + score ID
 *
 * Stratification (50 rows total):
 *   - 15 from "hard-L"  (model sentiment ≤ -2.5)
 *   - 15 from "hard-R"  (model sentiment ≥ +2.5)
 *   - 10 from "neutral" (|model sentiment| < 0.5)
 *   - 10 from "middle"  (rest — the rarely-used -2,-1,+1,+2 zone we want to
 *                        probe most)
 *
 * Within each bucket we sample uniformly at random across distinct
 * (channel, issue) pairs to keep the sample diverse.
 *
 * Run with:  npm run eval:extract-gold-set
 */
import "./_load-env";
import { createServiceClient } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";

interface SourceRow {
  score_id: string;
  sentiment: number;
  intensity: number;
  supporting_quote: string;
  issue_name: string;
  issue_slug: string;
  issue_left_position: string;
  issue_right_position: string;
  channel_id: string;
  channel_name: string;
  channel_lean: "L" | "M" | "R";
  episode_id: string;
  episode_title: string;
  episode_published_at: string;
}

type BucketLabel = "hard-L" | "hard-R" | "neutral" | "middle";

interface Bucket {
  label: BucketLabel;
  count: number;
  predicate: (s: number) => boolean;
}

const BUCKETS: Bucket[] = [
  { label: "hard-L", count: 15, predicate: (s) => s <= -2.5 },
  { label: "hard-R", count: 15, predicate: (s) => s >= 2.5 },
  { label: "neutral", count: 10, predicate: (s) => Math.abs(s) < 0.5 },
  {
    label: "middle",
    count: 10,
    predicate: (s) => Math.abs(s) >= 0.5 && Math.abs(s) < 2.5,
  },
];

/** Fisher-Yates shuffle in place. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Sample up to `n` rows from a bucket, prioritizing diversity across
 * (channel_id, issue_slug) pairs so no single show or issue dominates.
 */
function diverseSample(rows: SourceRow[], n: number): SourceRow[] {
  if (rows.length <= n) return shuffle(rows.slice());
  const shuffled = shuffle(rows.slice());
  const picked: SourceRow[] = [];
  const seenPairs = new Set<string>();
  // Pass 1: pick rows with unseen (channel, issue) pairs
  for (const r of shuffled) {
    if (picked.length >= n) break;
    const key = `${r.channel_id}::${r.issue_slug}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    picked.push(r);
  }
  // Pass 2: fill remaining slots from whatever's left
  if (picked.length < n) {
    const pickedIds = new Set(picked.map((r) => r.score_id));
    for (const r of shuffled) {
      if (picked.length >= n) break;
      if (pickedIds.has(r.score_id)) continue;
      picked.push(r);
    }
  }
  return picked;
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const db = createServiceClient();
  console.log("Fetching all scored mentions with their joined context...");

  // We need: sentiment_scores ← classifications ← episodes ← channels  +  issues
  // Pull in pages because the result set is several thousand rows with a
  // moderately heavy join.
  const all: SourceRow[] = [];
  const pageSize = 500;
  let page = 0;
  while (true) {
    const from = page * pageSize;
    const { data, error } = await db
      .from("sentiment_scores")
      .select(
        `
        id, sentiment, intensity,
        classification:classifications!sentiment_scores_classification_id_fkey (
          supporting_quote,
          issue_slug,
          issue:issues!classifications_issue_slug_fkey (
            name, left_position, right_position
          ),
          episode:episodes!classifications_episode_id_fkey (
            id, title, published_at,
            channel:channels!episodes_channel_id_fkey (
              id, name, political_lean, active
            )
          )
        )
      `,
      )
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const c = r.classification;
      const e = c?.episode;
      const ch = e?.channel;
      const issue = c?.issue;
      if (!c || !e || !ch || !issue) continue;
      // Skip deactivated channels (e.g., Bannon) — they shouldn't be in the
      // gold set since their data may be from a broken pipeline.
      if (ch.active === false) continue;
      all.push({
        score_id: r.id,
        sentiment: Number(r.sentiment),
        intensity: Number(r.intensity),
        supporting_quote: String(c.supporting_quote || ""),
        issue_name: issue.name,
        issue_slug: c.issue_slug,
        issue_left_position: issue.left_position,
        issue_right_position: issue.right_position,
        channel_id: ch.id,
        channel_name: ch.name,
        channel_lean: ch.political_lean,
        episode_id: e.id,
        episode_title: e.title,
        episode_published_at: e.published_at,
      });
    }
    page++;
    if (data.length < pageSize) break;
  }
  console.log(`Fetched ${all.length} mentions.`);

  // Bucket the rows
  const byBucket = new Map<BucketLabel, SourceRow[]>();
  for (const b of BUCKETS) byBucket.set(b.label, []);
  for (const r of all) {
    for (const b of BUCKETS) {
      if (b.predicate(r.sentiment)) {
        byBucket.get(b.label)!.push(r);
        break;
      }
    }
  }

  // Report bucket sizes so we can see if any are starved
  console.log("Bucket sizes before sampling:");
  for (const b of BUCKETS) {
    const have = byBucket.get(b.label)!.length;
    const want = b.count;
    const flag = have < want ? "  ← UNDERSIZED" : "";
    console.log(`  ${b.label.padEnd(8)}: ${have} available, sampling ${want}${flag}`);
  }

  // Sample
  const sampled: { row: SourceRow; bucket: BucketLabel }[] = [];
  for (const b of BUCKETS) {
    const pool = byBucket.get(b.label)!;
    const pick = diverseSample(pool, b.count);
    for (const r of pick) sampled.push({ row: r, bucket: b.label });
  }

  // Final shuffle so labeler doesn't see buckets contiguously
  shuffle(sampled);

  // Build CSVs
  const evalDir = path.resolve(__dirname, "..", "eval");
  fs.mkdirSync(evalDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);

  // Labeler-facing CSV — no model scores, channel name blinded
  const labelerHeaders = [
    "row_id",
    "channel_source",
    "episode_date",
    "issue",
    "issue_left_position",
    "issue_right_position",
    "quote",
    "labeler_sentiment",
    "labeler_intensity",
    "labeler_confidence",
    "labeler_notes",
  ];
  const labelerRows = sampled.map(({ row }, i) => [
    i + 1,
    `${row.channel_lean}-coded channel`,
    row.episode_published_at.slice(0, 10),
    row.issue_name,
    row.issue_left_position,
    row.issue_right_position,
    row.supporting_quote,
    "",
    "",
    "",
    "",
  ]);
  const labelerCsv = rowsToCsv(labelerHeaders, labelerRows);
  const labelerPath = path.join(evalDir, `gold-set-${dateStr}.csv`);
  fs.writeFileSync(labelerPath, labelerCsv, "utf-8");

  // Internal answer key — has everything we need to compute agreement after
  const keyHeaders = [
    "row_id",
    "score_id",
    "bucket",
    "model_sentiment",
    "model_intensity",
    "channel_name",
    "channel_lean",
    "episode_title",
    "episode_published_at",
    "issue_slug",
  ];
  const keyRows = sampled.map(({ row, bucket }, i) => [
    i + 1,
    row.score_id,
    bucket,
    row.sentiment,
    row.intensity,
    row.channel_name,
    row.channel_lean,
    row.episode_title,
    row.episode_published_at,
    row.issue_slug,
  ]);
  const keyCsv = rowsToCsv(keyHeaders, keyRows);
  const keyPath = path.join(evalDir, `gold-set-${dateStr}-answers.csv`);
  fs.writeFileSync(keyPath, keyCsv, "utf-8");

  console.log("\nWrote:");
  console.log(`  Labeler file: ${labelerPath}`);
  console.log(`  Answer key:   ${keyPath}`);
  console.log("\nNext steps:");
  console.log("  1. Open the labeler file, paste into Google Sheets");
  console.log("  2. Add the 3 calibration examples + instructions at the top");
  console.log("  3. Share the sheet with the colleague");
  console.log("  4. Keep the answers file private");
}

main().catch((e) => {
  console.error("extract-gold-set failed:", e);
  process.exit(1);
});
