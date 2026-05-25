/**
 * Seed the `gold_items` table with a stratified random sample of mentions for
 * online human labeling (the gold-set benchmark). Same sampling design as the
 * old CSV exporter (scripts/extract-gold-set.ts), but it writes rows to the
 * database so multiple labelers can score them through /eval/label instead of
 * a shared spreadsheet.
 *
 * The model's current sentiment/intensity are frozen onto each row at seed
 * time (model_sentiment/model_intensity) so re-scoring the production data
 * later can't move the answer key.
 *
 * Stratification (50 rows): 15 hard-L (≤ -2.5), 15 hard-R (≥ +2.5),
 * 10 neutral (|s| < 0.5), 10 middle (the rarely-used 0.5–2.5 zone we most
 * want human signal on).
 *
 * Run with:   npm run seed:gold-set
 * Reseed:     npm run seed:gold-set -- --reseed   (DELETES existing items AND
 *             all collected labels — use only before labeling has started)
 */
import "./_load-env";
import { createServiceClient } from "@/lib/db";

interface SourceRow {
  classification_id: string;
  sentiment: number;
  intensity: number;
  supporting_quote: string;
  issue_name: string;
  issue_slug: string;
  issue_left_position: string;
  issue_right_position: string;
  channel_id: string;
  channel_lean: "L" | "M" | "R";
  episode_published_at: string;
}

type BucketLabel = "hard-L" | "hard-R" | "neutral" | "middle";

const BUCKETS: { label: BucketLabel; count: number; predicate: (s: number) => boolean }[] = [
  { label: "hard-L", count: 15, predicate: (s) => s <= -2.5 },
  { label: "hard-R", count: 15, predicate: (s) => s >= 2.5 },
  { label: "neutral", count: 10, predicate: (s) => Math.abs(s) < 0.5 },
  { label: "middle", count: 10, predicate: (s) => Math.abs(s) >= 0.5 && Math.abs(s) < 2.5 },
];

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function diverseSample(rows: SourceRow[], n: number): SourceRow[] {
  if (rows.length <= n) return shuffle(rows.slice());
  const shuffled = shuffle(rows.slice());
  const picked: SourceRow[] = [];
  const seenPairs = new Set<string>();
  for (const r of shuffled) {
    if (picked.length >= n) break;
    const key = `${r.channel_id}::${r.issue_slug}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    picked.push(r);
  }
  if (picked.length < n) {
    const pickedIds = new Set(picked.map((r) => r.classification_id));
    for (const r of shuffled) {
      if (picked.length >= n) break;
      if (pickedIds.has(r.classification_id)) continue;
      picked.push(r);
    }
  }
  return picked;
}

async function main(): Promise<void> {
  const reseed = process.argv.includes("--reseed");
  const db = createServiceClient();

  const { count: existing } = await db
    .from("gold_items")
    .select("*", { count: "exact", head: true });

  if ((existing || 0) > 0 && !reseed) {
    console.log(
      `gold_items already has ${existing} rows. Re-run with --reseed to replace ` +
        `(this DELETES collected labels too). Aborting.`,
    );
    return;
  }
  if ((existing || 0) > 0 && reseed) {
    console.log(`--reseed: deleting ${existing} existing gold_items (and their labels)...`);
    await db.from("gold_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  console.log("Fetching scored mentions with context...");
  const all: SourceRow[] = [];
  const pageSize = 500;
  for (let page = 0; ; page++) {
    const from = page * pageSize;
    const { data, error } = await db
      .from("sentiment_scores")
      .select(
        `
        sentiment, intensity,
        classification:classifications!sentiment_scores_classification_id_fkey (
          id, supporting_quote, issue_slug,
          issue:issues!classifications_issue_slug_fkey ( name, left_position, right_position ),
          episode:episodes!classifications_episode_id_fkey (
            published_at,
            channel:channels!episodes_channel_id_fkey ( id, political_lean, active )
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
      if (ch.active === false) continue;
      all.push({
        classification_id: c.id,
        sentiment: Number(r.sentiment),
        intensity: Number(r.intensity),
        supporting_quote: String(c.supporting_quote || ""),
        issue_name: issue.name,
        issue_slug: c.issue_slug,
        issue_left_position: issue.left_position,
        issue_right_position: issue.right_position,
        channel_id: ch.id,
        channel_lean: ch.political_lean,
        episode_published_at: e.published_at,
      });
    }
    if (data.length < pageSize) break;
  }
  console.log(`Fetched ${all.length} mentions.`);

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

  console.log("Bucket sizes before sampling:");
  for (const b of BUCKETS) {
    const have = byBucket.get(b.label)!.length;
    console.log(`  ${b.label.padEnd(8)}: ${have} available, sampling ${b.count}${have < b.count ? "  ← UNDERSIZED" : ""}`);
  }

  const sampled: { row: SourceRow; bucket: BucketLabel }[] = [];
  for (const b of BUCKETS) {
    for (const r of diverseSample(byBucket.get(b.label)!, b.count)) {
      sampled.push({ row: r, bucket: b.label });
    }
  }
  shuffle(sampled); // so labelers don't see buckets contiguously

  const insertRows = sampled.map(({ row, bucket }, i) => ({
    row_num: i + 1,
    classification_id: row.classification_id,
    model_sentiment: row.sentiment,
    model_intensity: row.intensity,
    bucket,
    quote: row.supporting_quote,
    issue_name: row.issue_name,
    issue_left_position: row.issue_left_position,
    issue_right_position: row.issue_right_position,
    channel_lean: row.channel_lean,
    episode_date: row.episode_published_at.slice(0, 10),
  }));

  const { error: insErr } = await db.from("gold_items").insert(insertRows);
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);

  console.log(`\nSeeded ${insertRows.length} gold_items. Labelers can now score at /eval/label.`);
}

main().catch((e) => {
  console.error("seed-gold-set failed:", e);
  process.exit(1);
});
