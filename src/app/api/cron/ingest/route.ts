/**
 * Per-stage cron: ingest. Pulls recent episodes from YouTube + PodScan.
 * Scheduled in vercel.json; runs with its own 300s budget. Logs a usage_log
 * row populated for the ingest stage only.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runIngest } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("ingest", runIngest);
  await recordPipelineRun(
    { totalDurationMs: result.durationMs, stages: { ingest: { detail: result.detail } } },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  return NextResponse.json(result);
}
