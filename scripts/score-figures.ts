/**
 * Favorability-score public-figure mentions (Haiku) into `figure_scores`.
 * Idempotent: only scores `figure_mentions` with no score yet, upserts on
 * figure_mention_id. Scores + flushes in batches so progress is durable and
 * visible (a crash mid-run keeps everything already upserted). Bounded per run
 * (cost guardrail - one high-limit invocation, attended; do not loop loosely).
 *
 * Run:  npm run score:figures            (default 500)
 *       npm run score:figures -- 30000    (full backfill - run in background)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { scoreFigureMention, FIGURE_SCORE_PROMPT_VERSION } from "@/modules/score";
import { MODEL_SCORE } from "@/lib/anthropic";
import { estimateCostUsd } from "@/lib/pricing";

const CONCURRENCY = 10;
const BATCH = 300; // score + upsert this many at a time (durable progress)
const pick = (x: any) => (Array.isArray(x) ? x[0] : x);

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  const limit = parseInt(process.argv[2] || "500", 10);
  const db = createServiceClient();

  // Already-scored mention ids.
  const scored = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("figure_scores")
      .select("figure_mention_id")
      .order("figure_mention_id")
      .range(from, from + 999);
    if (error) throw new Error(`scores page: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as any[]) scored.add(r.figure_mention_id);
    if (data.length < 1000) break;
  }

  // Unscored mention ids, up to `limit`.
  const todo: string[] = [];
  outer: for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("figure_mentions")
      .select("id")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`mentions page: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as any[]) {
      if (!scored.has(r.id)) {
        todo.push(r.id);
        if (todo.length >= limit) break outer;
      }
    }
    if (data.length < 1000) break;
  }

  console.log(`\nScore figures - ${scored.size} already scored, scoring ${todo.length} now (batch ${BATCH}, concurrency ${CONCURRENCY})\n`);
  if (todo.length === 0) {
    console.log("Nothing to score.");
    return;
  }

  let totalScored = 0, totalUpserted = 0, inTok = 0, outTok = 0, errs = 0;

  for (let b = 0; b < todo.length; b += BATCH) {
    const ids = todo.slice(b, b + BATCH);

    // Hydrate this batch with quote + figure name + channel.
    const rows: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db
        .from("figure_mentions")
        .select("id, quote, figures(name), episodes(channels(name, political_lean))")
        .in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`hydrate: ${error.message}`);
      rows.push(...(data || []));
    }

    const results: any[] = [];
    await pool(rows, CONCURRENCY, async (row) => {
      const fig = pick(row.figures);
      const ch = pick(pick(row.episodes)?.channels);
      if (!fig?.name || !ch?.name) return;
      try {
        const r = await scoreFigureMention({
          figureName: fig.name,
          quote: row.quote,
          channelName: ch.name,
          politicalLean: (ch.political_lean || "M") as "L" | "M" | "R",
        });
        inTok += r.inputTokens || 0;
        outTok += r.outputTokens || 0;
        results.push({
          figure_mention_id: row.id,
          favorability: r.favorability,
          intensity: r.intensity,
          model: MODEL_SCORE,
          model_version: FIGURE_SCORE_PROMPT_VERSION,
        });
      } catch {
        errs += 1;
      }
    });
    totalScored += results.length;

    // Flush this batch immediately (durable progress).
    for (let i = 0; i < results.length; i += 500) {
      const { error, count } = await db
        .from("figure_scores")
        .upsert(results.slice(i, i + 500), { onConflict: "figure_mention_id", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(`upsert scores: ${error.message}`);
      totalUpserted += count ?? 0;
    }

    const cost = estimateCostUsd(MODEL_SCORE, { inputTokens: inTok, outputTokens: outTok });
    console.log(`  ${Math.min(b + BATCH, todo.length)}/${todo.length} | upserted ${totalUpserted} | errs ${errs} | est $${cost.toFixed(2)}`);
  }

  const cost = estimateCostUsd(MODEL_SCORE, { inputTokens: inTok, outputTokens: outTok });
  console.log(`\n${"-".repeat(56)}`);
  console.log(`Done. scored ${totalScored} (${errs} errors), upserted ${totalUpserted}.`);
  console.log(`Tokens: ${inTok} in / ${outTok} out · est cost $${cost.toFixed(3)}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
