/**
 * Per-stage cron: score. Runs Haiku over unscored classifications and upserts
 * sentiment_scores. Runs with its own 300s budget so it's no longer starved by
 * a long classify stage. Logs a usage_log row populated for the score stage.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runScore } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

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

  // The home-snapshot refresh moved to its own cron (/api/cron/snapshot,
  // v0.36.2): score saturates its 240s budget under backlog, so a tail-call
  // refresh here got killed at the 300s function limit - silently, because
  // its failure path was a swallowed console.error. Don't re-add it.

  return NextResponse.json(result);
}
