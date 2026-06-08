/**
 * Per-feature cron: Trending Names (BETA). Recomputes the named-entity burst
 * leaderboard from recent transcripts and writes it to dashboard_snapshot
 * (key `trending_v1`) for the home-page card. Daily, after ingest, so it
 * reflects each morning's fresh episodes. CRON_SECRET-guarded like all crons.
 */
import { type NextRequest, NextResponse } from "next/server";

import { assertCronAuth } from "@/lib/pipeline";
import { writeTrending } from "@/lib/trending";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;
  const payload = await writeTrending();
  return NextResponse.json({ ok: true, entities: payload.entities.length, computedAt: payload.computedAt });
}
