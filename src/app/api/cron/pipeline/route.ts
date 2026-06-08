/**
 * Manual full-pipeline run (ingest → transcribe → classify → score in one
 * request). NOT the scheduled cron anymore - the daily schedule is split into
 * four per-stage endpoints (see vercel.json + the sibling /api/cron/* routes)
 * so each stage gets its own 300s budget. Kept for ad-hoc full runs:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://soapbox.media/api/cron/pipeline
 *
 * On a large backlog this can still exceed 300s; for routine operation rely on
 * the per-stage crons. Logs to usage_log with source "manual".
 */
import { type NextRequest, NextResponse } from "next/server";
import {
  assertCronAuth,
  runStage,
  runIngest,
  runTranscribe,
  runClassify,
  runScore,
} from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";
import { writeHomeSnapshot } from "@/lib/aggregate";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  const ingest = await runStage("ingest", runIngest);
  const transcribe = await runStage("transcribe", runTranscribe);
  const classify = await runStage("classify", runClassify);
  const score = await runStage("score", runScore);

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    stages: { ingest, transcribe, classify, score },
  };

  await recordPipelineRun(summary, "manual").catch((e) => {
    console.error("recordPipelineRun failed:", e);
  });

  // Refresh the precomputed home-page snapshot after a full manual run.
  // Best-effort: never fail the run on a snapshot write.
  await writeHomeSnapshot().catch((e) =>
    console.error("writeHomeSnapshot failed:", e),
  );

  return NextResponse.json(summary);
}
