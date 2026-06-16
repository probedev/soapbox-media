/**
 * Per-stage cron: score-emerging. Runs Haiku over the top-N /emerging board
 * candidates' not-yet-scored member mentions and upserts discovery_topic_scores
 * (favorability). Own 300s budget; logs a usage_log row for the score-emerging
 * stage so it shows on /admin/pipeline + /admin/costs. Reads discovery_topics +
 * the live board, writes discovery_topic_scores - never touches the taxonomy.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runScoreEmerging } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("score-emerging", runScoreEmerging);
  await recordPipelineRun(
    { totalDurationMs: result.durationMs, stages: { "score-emerging": { detail: result.detail } } },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  return NextResponse.json(result);
}
