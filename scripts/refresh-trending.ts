/**
 * Manually recompute + persist the Trending Names snapshot (key `trending_v1`).
 * Mirrors what /api/cron/trending does. Run: npm run refresh:trending
 */
import "./_load-env";

import { writeTrending } from "@/lib/trending";

async function main() {
  const t0 = Date.now();
  const payload = await writeTrending();
  console.log(`trending_v1 refreshed in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${payload.entities.length} entities`);
  for (const e of payload.entities) {
    console.log(`  ${e.name.slice(0, 32).padEnd(32)} ${e.channels} shows · ${e.recentMentions} mentions · ${e.burst}× · top: ${e.topChannels.slice(0, 3).map((c) => c.name).join(", ")}`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
