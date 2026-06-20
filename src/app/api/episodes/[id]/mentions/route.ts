/**
 * Per-episode classification + score detail, lazy-loaded when an activity-log
 * row is expanded. Returns every issue mention the classifier found in this
 * episode, each with its supporting quote and sentiment/intensity score - the
 * "receipts" behind the status dots. Fetched on demand (one episode at a time)
 * so the /log table never eager-loads the full classifications join.
 *
 * Public data (the /log page is public); read server-side via the service-role
 * client like every other read in the app.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db";
import type { EpisodeMention, EpisodeMentionsResponse } from "@/lib/episodes";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("classifications")
    .select(
      `issue_slug, supporting_quote, start_ts,
       issue:issues!classifications_issue_slug_fkey ( name ),
       episode:episodes!classifications_episode_id_fkey ( source_url ),
       score:sentiment_scores!sentiment_scores_classification_id_fkey ( sentiment, intensity )`,
    )
    .eq("episode_id", params.id)
    .order("issue_slug", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sourceUrl: string | null = null;
  const mentions: EpisodeMention[] = (data || []).map((r: any) => {
    // sentiment_scores is one-to-one on classification_id, but PostgREST embeds
    // a reverse relation as an array - normalize either shape.
    const score = Array.isArray(r.score) ? r.score[0] : r.score;
    const issue = Array.isArray(r.issue) ? r.issue[0] : r.issue;
    const episode = Array.isArray(r.episode) ? r.episode[0] : r.episode;
    if (episode?.source_url) sourceUrl = episode.source_url;
    return {
      issueSlug: r.issue_slug,
      issueName: issue?.name || r.issue_slug,
      quote: r.supporting_quote || "",
      sentiment: score ? Number(score.sentiment) : null,
      intensity: score ? Number(score.intensity) : null,
      startTs: r.start_ts != null ? Number(r.start_ts) : null,
    };
  });

  // Strongest first within the episode: |sentiment| × intensity (the per-mention
  // push on the Index), so the most consequential calls surface at the top.
  mentions.sort((a, b) => {
    const wa = Math.abs(a.sentiment ?? 0) * (a.intensity ?? 0);
    const wb = Math.abs(b.sentiment ?? 0) * (b.intensity ?? 0);
    return wb - wa;
  });

  // Intensity-weighted net lean across scored mentions.
  let weightedSum = 0;
  let weight = 0;
  for (const m of mentions) {
    if (m.sentiment != null && m.intensity != null) {
      weightedSum += m.sentiment * m.intensity;
      weight += m.intensity;
    }
  }

  const body: EpisodeMentionsResponse = {
    episodeId: params.id,
    sourceUrl,
    mentions,
    netLean: weight > 0 ? weightedSum / weight : null,
    numIssues: new Set(mentions.map((m) => m.issueSlug)).size,
  };
  return NextResponse.json(body);
}
