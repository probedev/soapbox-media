/**
 * One-off: apply the 2026-06-06 editorial reach calibration to the 77
 * placeholder podcasts (reach = 300k seeder default). Estimates were
 * produced by multi-signal research (charts, publisher announcements,
 * Edison/Triton where public, YouTube presence) anchored to the ~28
 * trusted editorial reach values, with Podchaser powerScore as a weak
 * prior — reviewed and approved row-by-row before this run.
 *
 * Guards: only touches active podcast rows whose reach is EXACTLY the
 * 300k placeholder, so re-running is a no-op and editorial anchors are
 * untouchable. Reads /tmp/reach-estimates.json (name → reach).
 *
 * Run:  npx tsx scripts/apply-reach-estimates.ts
 */
import "./_load-env";

import { readFileSync } from "fs";
import { createServiceClient } from "@/lib/db";

const PLACEHOLDER = 300_000;

async function main() {
  const estimates: { name: string; reach: number; confidence: string }[] =
    JSON.parse(readFileSync("/tmp/reach-estimates.json", "utf8"));
  const db = createServiceClient();

  let updated = 0, skipped = 0;
  for (const e of estimates) {
    const { data, error } = await db
      .from("channels")
      .update({ reach: e.reach, reach_updated_at: new Date().toISOString() })
      .eq("platform", "podcast")
      .eq("active", true)
      .eq("name", e.name)
      .eq("reach", PLACEHOLDER) // only placeholders — anchors untouchable
      .select("id");
    if (error) throw new Error(`${e.name}: ${error.message}`);
    if (data && data.length === 1) {
      updated++;
      console.log(`  ✓ ${e.name.slice(0, 42).padEnd(42)} → ${e.reach.toLocaleString()}`);
    } else {
      skipped++;
      console.log(`  – ${e.name.slice(0, 42).padEnd(42)} skipped (${data?.length ?? 0} rows matched)`);
    }
  }
  console.log(`\nUpdated ${updated} · skipped ${skipped} (expected 77/0 on first run)`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
