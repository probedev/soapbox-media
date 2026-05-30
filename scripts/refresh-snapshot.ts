/**
 * Recompute and persist the home-page dashboard snapshot immediately.
 *
 * The snapshot is normally refreshed at the end of the score cron, but that
 * runs only every 6h. Use this to force an instant refresh after a manual
 * pipeline run, a deploy, or while developing.
 *
 * Run with:  npm run refresh:snapshot
 */
import "./_load-env";

import { writeHomeSnapshot } from "@/lib/aggregate";

async function main() {
  const t0 = Date.now();
  const snap = await writeHomeSnapshot();
  const ms = Date.now() - t0;
  console.log(
    `dashboard_snapshot refreshed in ${(ms / 1000).toFixed(1)}s — ` +
      `index ${snap.dashboard.index.toFixed(2)}, ` +
      `${snap.dashboard.issues.length} issues, ` +
      `${snap.breakdown.issues.length} breakdown rows, ` +
      `hasData=${snap.dashboard.hasData}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
