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
import { createServiceClient } from "@/lib/db";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const HOME_WINDOW_DAYS = 7;

/** Classified episodes published in the Index window. Cheap: the
 *  (transcript_status, published_at) and published_at indexes cover it. */
async function countClassifiedEpisodesInWindow(windowDays: number): Promise<number> {
  const db = createServiceClient();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { count, error } = await db
    .from("episodes")
    .select("id", { count: "exact", head: true })
    .eq("classify_status", "processed")
    .gte("published_at", since);
  if (error) throw new Error(`countClassifiedEpisodesInWindow: ${error.message}`);
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const t0 = Date.now();
  try {
    const snap = await writeHomeSnapshot(HOME_WINDOW_DAYS);
    const durationMs = Date.now() - t0;

    // Empty-window guard (v0.39.1). With ~400 episodes ingested a day, zero
    // scored mentions in the window can only mean an upstream stage stopped
    // producing - which is exactly what happened when the score cron died in
    // Sept 2026: this cron kept publishing an Index of 0.0 every hour, with
    // nothing in usage_log to say so. The snapshot is still written (the page
    // shows the truth), but the run is recorded as a failure so it paints red
    // on /admin/pipeline and 500s in Vercel's cron log.
    const scoredInWindow = snap.dashboard.numClassifications;
    const classifiedEpisodes =
      scoredInWindow === 0 ? await countClassifiedEpisodesInWindow(HOME_WINDOW_DAYS) : -1;
    if (scoredInWindow === 0 && classifiedEpisodes > 0) {
      const message =
        `snapshot: 0 scored mentions in the ${HOME_WINDOW_DAYS}-day window while ` +
        `${classifiedEpisodes} classified episodes exist there - the score stage is not keeping up`;
      console.error("cron/snapshot degraded:", message);
      await recordScriptRun({
        label: "snapshot",
        source: "cron",
        durationMs,
        raw: { index: snap.dashboard.index, asOfDate: snap.dashboard.asOfDate, issues: 0 },
        errorMessage: message,
      });
      return NextResponse.json(
        { ok: false, degraded: true, durationMs, asOfDate: snap.dashboard.asOfDate, error: message },
        { status: 500 },
      );
    }

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
