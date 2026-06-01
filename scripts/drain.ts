/**
 * Drain the full pipeline backlog now, using the parallelized pipeline stages
 * (transcribe → classify → score). Loops each stage until a round makes no
 * progress, then moves on. Processes whatever is pending across BOTH cohorts
 * (independent + legacy) — classify/score are cohort-agnostic; the Index stays
 * independent-only regardless.
 *
 * Run with:  npm run drain
 *
 * Cost: transcribe = Supadata credits (cheap); classify = Sonnet (~$0.05/ep);
 * score = Haiku (cheap). Bounded by a per-round safety cap.
 */
import "./_load-env";

import { runTranscribe, runClassify, runScore } from "@/lib/pipeline";

async function drainStage(
  name: string,
  fn: () => Promise<Record<string, unknown>>,
  progressKey: string,
  maxRounds = 40,
) {
  let consecutiveErrors = 0;
  for (let round = 1; round <= maxRounds; round++) {
    const t0 = Date.now();
    let r: Record<string, unknown>;
    try {
      r = await fn();
      consecutiveErrors = 0;
    } catch (e: any) {
      // Transient network blips (Supadata/Supabase fetch failed) shouldn't kill
      // a long drain — back off and retry the round. Idempotent, so safe.
      consecutiveErrors++;
      console.warn(
        `[${name}] round ${round} error (${consecutiveErrors}/5): ${e?.message || e}`,
      );
      if (consecutiveErrors >= 5) {
        console.error(`[${name}] giving up after 5 consecutive errors`);
        break;
      }
      await new Promise((res) => setTimeout(res, 5000 * consecutiveErrors));
      round--; // retry this round
      continue;
    }
    const did = Number(r[progressKey] ?? 0);
    console.log(
      `[${name}] round ${round} (${((Date.now() - t0) / 1000).toFixed(0)}s): ${progressKey}=${did} ${JSON.stringify(r)}`,
    );
    if (did === 0) break; // queue drained (or only-failures remain)
  }
}

async function main() {
  console.log("Draining pipeline backlog (parallelized stages)…\n");
  await drainStage("transcribe", runTranscribe, "succeeded");
  await drainStage("classify", runClassify, "processed");
  await drainStage("score", runScore, "succeeded");
  console.log("\nDrain complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
