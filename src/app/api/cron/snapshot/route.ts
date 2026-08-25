/**
 * Per-stage cron: snapshot. Recomputes the precomputed home-page aggregate
 * (dashboard_snapshot `home:7`) that the homepage, /issues, /support, the MCP
 * get_index tool, and homelab all serve.
 *
 * Split out of the score cron in v0.36.2: score saturates its full 240s
 * STAGE_TIME_BUDGET_MS whenever there's a backlog, so a tail-call refresh in
 * the same 300s function got killed mid-write - and its `.catch(console.error)`
 * swallowed the statement-timeout failures that froze the snapshot from
 * 2026-06-30 to 2026-08-25. Running in its own function gives the refresh the
 * whole 300s, and any failure now lands in usage_log.error_message where
 * /admin/pipeline shows it.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/pipeline";
import { recordScriptRun } from "@/lib/usage";
import { writeHomeSnapshot } from "@/lib/aggregate";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const snap = await writeHomeSnapshot();
    const durationMs = Date.now() - t0;
    await recordScriptRun({
      label: "snapshot",
      source: "cron",
      durationMs,
      raw: {
        index: snap.dashboard.index,
        asOfDate: snap.dashboard.asOfDate,
        issues: snap.dashboard.issues.length,
      },
    });
    return NextResponse.json({
      ok: true,
      durationMs,
      asOfDate: snap.dashboard.asOfDate,
    });
  } catch (e) {
    const durationMs = Date.now() - t0;
    const message = e instanceof Error ? e.message : String(e);
    console.error("cron/snapshot failed:", message);
    await recordScriptRun({
      label: "snapshot",
      source: "cron",
      durationMs,
      errorMessage: `snapshot: ${message}`,
    });
    return NextResponse.json({ ok: false, durationMs, error: message }, { status: 500 });
  }
}
