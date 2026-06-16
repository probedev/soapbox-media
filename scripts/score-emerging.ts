/**
 * Score emerging-topic favorability for the top-N /emerging board candidates.
 * Thin CLI wrapper around runScoreEmerging() - the exact logic the
 * score-emerging cron runs - so a manual drain / first-run population uses
 * identical code. Idempotent (upserts on the stable discovery_topic_id), so
 * safe to re-run; a second run with nothing new reports succeeded: 0.
 *
 * Run with:  npm run score:emerging
 */
import "./_load-env";

import { runScoreEmerging } from "@/lib/pipeline";
import { recordScriptRun } from "@/lib/usage";

async function main() {
  const startedAt = Date.now();
  console.log("\nSoapbox score:emerging\n" + "-".repeat(60));
  const detail = await runScoreEmerging();
  console.log(JSON.stringify(detail, null, 2));

  await recordScriptRun({
    label: "score-emerging CLI",
    source: "cli",
    durationMs: Date.now() - startedAt,
    score: { succeeded: Number(detail.succeeded) || 0, failed: Number(detail.failed) || 0 },
    inputTokens: Number(detail.inputTokens) || 0,
    outputTokens: Number(detail.outputTokens) || 0,
    costUsd: Number(detail.approxCostUsd) || 0,
  });
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
