/**
 * Per-stage cron: classify. Runs Sonnet over pending transcripts and writes
 * issue mentions. Runs with its own 300s budget — this is the stage that blew
 * the combined pipeline past 300s once it started doing real work (v0.6.29).
 * Logs a usage_log row populated for the classify stage.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runClassify } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("classify", runClassify);
  await recordPipelineRun(
    { totalDurationMs: result.durationMs, stages: { classify: { detail: result.detail } } },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  return NextResponse.json(result);
}
