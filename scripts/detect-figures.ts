/**
 * Detect public-figure mentions in episode transcripts and upsert candidate
 * favorability windows into `figure_mentions`. No LLM (cheap); the Haiku
 * favorability pass runs separately over the rows this produces.
 *
 * Thin CLI over the shared stage logic in src/lib/pipeline.ts
 * (detectFigureMentions), which the daily /api/cron/figures also runs -
 * whole-word alias matching, nearby-mention dedup, ad-read filter, per-figure
 * -per-episode cap, keyset pagination. Idempotent on
 * (episode_id, figure_slug, char_offset), so re-runs and overlaps no-op.
 *
 * Run:  npm run detect:figures            (last 120 days)
 *       npm run detect:figures -- 365      (last N days; use a big N for full)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { detectFigureMentions } from "@/lib/pipeline";

async function main() {
  const days = parseInt(process.argv[2] || "120", 10);
  const db = createServiceClient();
  console.log(`\nDetect figures - transcripts published in last ${days}d\n`);

  // CLI runs are attended: no deadline (Infinity), page-by-page progress.
  const result = await detectFigureMentions(db, days, Infinity, (p) =>
    console.log(`  scanned ${p.scanned} transcripts | ${p.windows} windows | ${p.newMentions} new mentions`),
  );

  console.log(`\n${"-".repeat(56)}`);
  console.log(
    `Done. ${result.scanned} transcripts scanned, ${result.windows} windows, ${result.newMentions} new mentions upserted.`,
  );
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
