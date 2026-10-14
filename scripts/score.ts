/**
 * Score pending classifications.
 *
 * For each classification that doesn't yet have a sentiment_score, run the
 * score module (Haiku 4.5) and write the result into sentiment_scores.
 *
 * Run with:  npm run score
 * Override:  npm run score -- <limit> [lookbackDays]
 *            e.g. npm run score -- 100
 *                 npm run score -- 25000 30   (drain a month-deep backlog)
 *
 * The pending set comes from fetchPendingClassifications (src/lib/pipeline.ts,
 * v0.39.1): a bounded, index-driven lookup over episodes in the last
 * `lookbackDays` (default SCORE_LOOKBACK_DAYS). It no longer pages the whole
 * classifications + sentiment_scores tables, which took 7-10 minutes by
 * 2026-10 and is what killed the cron.
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { scoreClassification } from "@/modules/score";
import { MODEL_SCORE } from "@/lib/anthropic";
import { estimateCostUsd } from "@/lib/pricing";
import { recordScriptRun } from "@/lib/usage";
import { mapPool } from "@/lib/concurrency";
import { fetchPendingClassifications, SCORE_LOOKBACK_DAYS } from "@/lib/pipeline";

// Match production scoring (SCORE_CONCURRENCY in src/lib/pipeline.ts). Haiku is
// fast and scoring one short quote is cheap, so serial was needlessly slow on a
// large manual drain; concurrency 15 finishes thousands in minutes.
const SCORE_CONCURRENCY = 15;

async function main() {
  const limit = parseInt(process.argv[2] || "50", 10);
  const lookbackDays = parseInt(process.argv[3] || String(SCORE_LOOKBACK_DAYS), 10);
  const startedAt = Date.now();

  console.log(`\nSoapbox score`);
  console.log(`─`.repeat(60));
  console.log(
    `Processing up to ${limit} unscored classifications from the last ${lookbackDays} days using ${MODEL_SCORE}\n`,
  );

  const db = createServiceClient();

  const t0 = Date.now();
  const found = await fetchPendingClassifications(db, {
    sinceDays: lookbackDays,
    limit,
    deadline: Number.POSITIVE_INFINITY, // no function limit on the CLI
  });
  console.log(
    `Lookup: ${found.episodes} episodes, ${found.candidates} classifications, ` +
      `${found.pendingTotal} unscored (${((Date.now() - t0) / 1000).toFixed(1)}s).`,
  );
  const pending = found.rows;

  if (pending.length === 0) {
    console.log("All classifications already scored. Nothing to do.");
    return;
  }
  console.log(`Found ${found.pendingTotal} unscored classifications. Processing first ${pending.length}.\n`);

  const slice = pending.slice(0, limit);
  let ok = 0;
  let failed = 0;
  let processed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Score through a bounded-concurrency pool (counters mutate safely - JS is
  // single-threaded, the += never interleaves; see src/lib/concurrency.ts).
  await mapPool(slice, SCORE_CONCURRENCY, async (c) => {
    try {
      const result = await scoreClassification({
        quote: c.supporting_quote,
        channelName: c.episode?.channel?.name || "(unknown)",
        politicalLean: c.episode?.channel?.political_lean || "M",
        issueName: c.issue?.name || "",
        issueDefinition: c.issue?.definition || "",
        leftPosition: c.issue?.left_position || "",
        rightPosition: c.issue?.right_position || "",
      });

      totalInputTokens += result.inputTokens || 0;
      totalOutputTokens += result.outputTokens || 0;

      const { error: insErr } = await db.from("sentiment_scores").upsert(
        {
          classification_id: c.id,
          sentiment: result.sentiment,
          intensity: result.intensity,
          supporting_quote: c.supporting_quote,
          model: MODEL_SCORE,
          model_version: "v0",
        },
        // Idempotent: a UNIQUE(classification_id) constraint backs this, so
        // overlapping score runs (CLI + cron) no-op instead of inserting a
        // duplicate score. See 2026-05-24 dedup incident.
        { onConflict: "classification_id", ignoreDuplicates: true },
      );
      if (insErr) {
        console.log(`✗ insert ${c.id}: ${insErr.message}`);
        failed += 1;
      } else {
        ok += 1;
      }
    } catch (e: any) {
      console.log(`✗ ${c.id}: ${e.message}`);
      failed += 1;
    }
    processed += 1;
    if (processed % 100 === 0) {
      console.log(`[${processed}/${slice.length}] scored ${ok} · failed ${failed}`);
    }
  });

  // Summary
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scored: ${ok}, failed: ${failed}`);
  console.log(`Tokens — input: ${totalInputTokens.toLocaleString()}, output: ${totalOutputTokens.toLocaleString()}`);
  const cost = estimateCostUsd(MODEL_SCORE, {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  });
  console.log(`Approx cost this run: $${cost.toFixed(3)}`);

  // Record this manual run so /admin/costs reflects terminal spend, not just cron.
  await recordScriptRun({
    label: `score CLI (limit ${limit})`,
    source: "cli",
    durationMs: Date.now() - startedAt,
    score: { succeeded: ok, failed },
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    costUsd: cost,
  });

  const { count } = await db
    .from("sentiment_scores")
    .select("*", { count: "exact", head: true });
  console.log(`Sentiment_scores table now contains: ${count} rows`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
