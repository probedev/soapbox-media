/**
 * Per-stage cron: ads (v0.38.0). Runs the regex sponsor-read detect pass over
 * the last few days of transcripts (free), then the Haiku confirm pass over
 * pending ad_segments (bounded by ADS_CONFIRM_LIMIT + the stage time budget;
 * well under $0.5/day at current volume). Own 300s budget; logs a usage_log
 * row so it shows on /admin/pipeline + /admin/costs.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runAds } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("ads", runAds);
  await recordPipelineRun(
    { totalDurationMs: result.durationMs, stages: { ads: { detail: result.detail } } },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  return NextResponse.json(result);
}
