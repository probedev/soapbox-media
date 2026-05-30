/**
 * Per-stage cron: score. Runs Haiku over unscored classifications and upserts
 * sentiment_scores. Runs with its own 300s budget so it's no longer starved by
 * a long classify stage. Logs a usage_log row populated for the score stage.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runScore } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";
import { writeHomeSnapshot } from "@/lib/aggregate";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("score", runScore);
  await recordPipelineRun(
    { totalDurationMs: result.durationMs, stages: { score: { detail: result.detail } } },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  // Score is the last data-producing stage, so refresh the precomputed
  // home-page snapshot now that new sentiment_scores may have landed.
  // Best-effort: a snapshot failure must not fail the scoring cron.
  await writeHomeSnapshot().catch((e) =>
    console.error("writeHomeSnapshot failed:", e),
  );

  return NextResponse.json(result);
}
