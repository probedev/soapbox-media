/**
 * Weekly cron: rebuild emerging-issue discovery candidates by clustering recent
 * off-taxonomy topics. Surfaces them at /admin/discovery for human-gated review.
 * Not a pipeline stage - it reads discovery_topics and writes
 * discovery_candidates; it never edits the taxonomy.
 */
import { type NextRequest, NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/pipeline";
import { buildDiscoveryCandidates } from "@/lib/discovery";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const result = await buildDiscoveryCandidates();
  return NextResponse.json(result);
}
