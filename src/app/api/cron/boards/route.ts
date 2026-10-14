/**
 * Daily cron: boards (v0.40.0). Precomputes the /figures and /advertisers
 * overview boards into dashboard_snapshot after the figures (11:40 UTC) and
 * ads (12:10 UTC) crons have run, so those pages read one row instead of
 * scanning a month of scores per request (28s / 10s TTFB before). Own 300s
 * budget; records a usage_log row either way, with error_message on failure,
 * so a silent stall shows up on /admin/pipeline (the June-August 2026 lesson).
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/pipeline";
import { recordScriptRun } from "@/lib/usage";
import { writeBoardSnapshots } from "@/lib/aggregate";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const summary = await writeBoardSnapshots();
    const durationMs = Date.now() - t0;
    await recordScriptRun({
      label: "boards",
      source: "cron",
      durationMs,
      raw: { figures: summary.figures, advertisers: summary.advertisers },
    });
    return NextResponse.json({ ok: true, durationMs, ...summary });
  } catch (e) {
    const durationMs = Date.now() - t0;
    const message = e instanceof Error ? e.message : String(e);
    console.error("cron/boards failed:", message);
    await recordScriptRun({
      label: "boards",
      source: "cron",
      durationMs,
      errorMessage: `boards: ${message}`,
    });
    return NextResponse.json({ ok: false, durationMs, error: message }, { status: 500 });
  }
}
