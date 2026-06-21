/**
 * View-count snapshot stage (CLI).
 *
 * Runs the same `runMetrics` stage the /api/cron/metrics cron runs: snapshots
 * each active YouTube episode's view count once per UTC day for its first
 * METRICS_HORIZON_DAYS, into episode_metrics. Phase-0 collection only - does
 * NOT touch the reach algorithm or the Index.
 *
 * Run with:   npm run metrics
 */
import "./_load-env";

import { runMetrics } from "@/lib/pipeline";

(async () => {
  const result = await runMetrics();
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
