/**
 * Per-stage cron: metrics. Snapshots each active YouTube episode's view count
 * once per UTC day for its first METRICS_HORIZON_DAYS, banking the view-growth
 * curve into episode_metrics (Phase-0 collection, v0.32.0). Pure producer -
 * nothing reads this in aggregation, so the reach algorithm and the Index are
 * untouched. Runs with its own 300s budget; logs a usage_log row.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth, runStage, runMetrics } from "@/lib/pipeline";
import { recordPipelineRun } from "@/lib/usage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await runStage("metrics", runMetrics);
  await recordPipelineRun(
    { totalDurationMs: result.durationMs, stages: { metrics: { detail: result.detail } } },
    "cron",
  ).catch((e) => console.error("recordPipelineRun failed:", e));

  return NextResponse.json(result);
}
