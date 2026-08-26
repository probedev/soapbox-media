/**
 * Backfill host-read sponsor detection over historical transcripts, then
 * confirm every pending segment with Haiku. Seeds /advertisers with months of
 * data; the daily /api/cron/ads keeps it current afterward.
 *
 * Thin CLI over the shared stage logic in src/lib/pipeline.ts (detectAds +
 * confirmPendingAds). Idempotent: detect upserts on (episode_id, char_start)
 * with ignoreDuplicates, settled verdicts are never re-judged, so re-runs and
 * partial runs are safe and only pay for still-pending segments.
 *
 * Attended run, but hard-capped anyway (the classify-runaway lesson,
 * CLAUDE.md): stops at MAX_CONFIRMS LLM calls no matter what. Expected cost
 * for a 120-day backfill: ~15-20K confirms at ~$0.001 each, roughly $20.
 *
 * Run:  npm run backfill:ads            (last 120 days)
 *       npm run backfill:ads -- 90       (last N days)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { detectAds, confirmPendingAds } from "@/lib/pipeline";
import { MODEL_SCORE } from "@/lib/anthropic";
import { estimateCostUsd } from "@/lib/pricing";
import { recordScriptRun } from "@/lib/usage";

const MAX_CONFIRMS = 30_000;
const BATCH = 500;
const CONCURRENCY = 10;

async function main() {
  const days = parseInt(process.argv[2] || "120", 10);
  const db = createServiceClient();
  const t0 = Date.now();
  console.log(`\nBackfill ads - transcripts published in last ${days}d\n`);

  // 1) Detect (free). CLI runs are attended: no deadline, page progress.
  const detect = await detectAds(db, days, Infinity, (p) =>
    console.log(`  scanned ${p.scanned} transcripts | ${p.candidates} candidates | ${p.newSegments} new segments`),
  );
  console.log(
    `\nDetect done: ${detect.scanned} transcripts, ${detect.candidates} candidates, ${detect.newSegments} new pending segments.\n`,
  );

  // 2) Confirm until dry (or the safety cap).
  let confirmed = 0;
  let ads = 0;
  let selfPromo = 0;
  let notAd = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (;;) {
    if (confirmed + failed >= MAX_CONFIRMS) {
      console.log(`\nSafety cap of ${MAX_CONFIRMS} LLM calls reached - stopping. Re-run to continue.`);
      break;
    }
    const batch = await confirmPendingAds(db, BATCH, CONCURRENCY, Infinity);
    if (batch.pendingFound === 0) break;
    confirmed += batch.ads + batch.selfPromo + batch.notAd;
    ads += batch.ads;
    selfPromo += batch.selfPromo;
    notAd += batch.notAd;
    failed += batch.failed;
    inputTokens += batch.inputTokens;
    outputTokens += batch.outputTokens;
    const cost = estimateCostUsd(MODEL_SCORE, { inputTokens, outputTokens });
    console.log(
      `  confirmed ${confirmed} (${ads} ads / ${selfPromo} self-promo / ${notAd} not-ad, ${failed} failed) | ~$${cost.toFixed(2)}`,
    );
    // A batch that only produced failures would loop forever on the same
    // pending rows - bail and let a re-run (or the daily cron) retry.
    if (batch.ads + batch.selfPromo + batch.notAd === 0) {
      console.log("  batch made no progress (all failures) - stopping.");
      break;
    }
  }

  const costUsd = estimateCostUsd(MODEL_SCORE, { inputTokens, outputTokens });
  console.log(`\n${"-".repeat(56)}`);
  console.log(
    `Done. ${detect.newSegments} new segments; ${confirmed} confirmed (${ads} ads, ${selfPromo} self-promo, ${notAd} not-ad), ${failed} failed.`,
  );
  console.log(`LLM spend: $${costUsd.toFixed(2)} (${inputTokens} in / ${outputTokens} out)`);

  await recordScriptRun({
    label: `backfill-ads (${days}d)`,
    source: "manual",
    durationMs: Date.now() - t0,
    inputTokens,
    outputTokens,
    costUsd,
    raw: { detect, confirmed, ads, selfPromo, notAd, failed },
  });
}

main().catch(async (err) => {
  console.error("\nFATAL:", err);
  await recordScriptRun({
    label: "backfill-ads",
    source: "manual",
    errorMessage: String(err?.message || err),
  }).catch(() => {});
  process.exit(1);
});
