/**
 * Per-stage cron: figures. Revives the Public Figures favorability feature
 * (v0.33.0), which shipped as a one-time backfill and froze on 2026-06-23.
 * Runs the regex detect pass over the last few days of transcripts (free),
 * then Haiku favorability over unscored figure_mentions (bounded by
 * FIGURES_SCORE_LIMIT + the stage time budget; ~$0.5/day at current volume).
 * Own 300s budget; logs a usage_log row so it shows on /admin/pipeline +
 * /admin/costs.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runFigures } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("figures", runFigures);
  await recordPipelineRun(
    {
      totalDurationMs: result.durationMs,
      stages: { figures: { ok: result.ok, detail: result.detail } },
    },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
