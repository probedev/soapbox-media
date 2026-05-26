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

  return NextResponse.json(result);
}
