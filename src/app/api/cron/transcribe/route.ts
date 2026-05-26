/**
 * Per-stage cron: transcribe. Fetches transcripts for pending episodes
 * (Supadata/YouTube captions; PodScan transcripts arrive at ingest). Runs with
 * its own 300s budget. Logs a usage_log row populated for the transcribe stage.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runTranscribe } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("transcribe", runTranscribe);
  await recordPipelineRun(
    { totalDurationMs: result.durationMs, stages: { transcribe: { detail: result.detail } } },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  return NextResponse.json(result);
}
