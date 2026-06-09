/**
 * Per-channel, per-issue mention detail, lazy-loaded when an issue row on the
 * channel page is expanded. Returns the same scored "receipts" we already store
 * and show per episode (supporting quote + sentiment + intensity), but filtered
 * to one channel's coverage of one issue over the last 30 days.
 *
 * Counts match the "N mentions" shown on the collapsed row: getChannelDrillDown
 * counts SCORED classifications for this channel's episodes, this issue, in the
 * last 30 days, with NO cohort filter (aggregate.ts:1044). This query starts
 * from sentiment_scores (scored-only) with the same channel/issue/window filters
 * via !inner embeds, so PostgREST filters parents, not just the embed. We do NOT
 * reuse searchMentions: it hardcodes channel.active=true, which would zero out a
 * deactivated channel's page.
 *
 * Public data, read server-side via the service-role client like every read.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface ChannelIssueMention {
  /** The exact transcript excerpt the model flagged. Never the full transcript. */
  quote: string;
  /** -5..+5; negative pulls Left, positive Right. Scored, so never null here. */
  sentiment: number;
  /** 1..5 model conviction. */
  intensity: number;
  episodeTitle: string;
  episodeUrl: string;
  publishedAt: string;
}

export interface ChannelIssueMentionsResponse {
  mentions: ChannelIssueMention[];
  count: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; slug: string } },
) {
  const db = createServiceClient();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffIso = cutoff.toISOString();

  // Paginate with stable id order; Max Rows cap is 1000 (see
  // [[pagination-stable-order]]). One channel+issue over 30 days is small, but
  // the loop avoids a silent truncation footgun on a high-volume channel.
  const pageSize = 1000;
  const maxPages = 20;
  const raw: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await db
      .from("sentiment_scores")
      .select(
        `id, sentiment, intensity,
         classification:classifications!sentiment_scores_classification_id_fkey!inner (
           issue_slug, supporting_quote,
           episode:episodes!classifications_episode_id_fkey!inner (
             title, source_url, published_at,
             channel:channels!episodes_channel_id_fkey!inner ( id )
           )
         )`,
      )
      .eq("classification.issue_slug", params.slug)
      .eq("classification.episode.channel.id", params.id)
      .gte("classification.episode.published_at", cutoffIso)
      .order("id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    raw.push(...data);
    if (data.length < pageSize) break;
  }

  const mentions: ChannelIssueMention[] = raw.map((r) => {
    const c = r.classification;
    const e = c.episode;
    return {
      quote: c.supporting_quote || "",
      sentiment: Number(r.sentiment),
      intensity: Number(r.intensity),
      episodeTitle: e.title || "(untitled)",
      episodeUrl: e.source_url || "#",
      publishedAt: e.published_at,
    };
  });

  // Strongest first: |sentiment| × intensity (the per-mention push on the Index),
  // matching how the episode receipts panel orders its mentions.
  mentions.sort(
    (a, b) =>
      Math.abs(b.sentiment) * b.intensity - Math.abs(a.sentiment) * a.intensity,
  );

  const body: ChannelIssueMentionsResponse = {
    mentions,
    count: mentions.length,
  };
  return NextResponse.json(body);
}
