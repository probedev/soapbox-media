/**
 * Recompute and persist the /figures and /advertisers board snapshots now.
 *
 * Normally refreshed once a day by /api/cron/boards (12:20 UTC, after the
 * figures and ads crons). Use this after a deploy or a manual figures / ads
 * run to make the boards current immediately.
 *
 * Run with:  npm run refresh:boards
 */
import "./_load-env";

import { writeBoardSnapshots } from "@/lib/aggregate";

async function main() {
  const t0 = Date.now();
  const s = await writeBoardSnapshots();
  const windows = Object.entries(s.advertisers)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log(
    `board snapshots refreshed in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
      `${s.figures} figures; advertisers ${windows}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
