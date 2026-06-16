/**
 * Public receipts for one emerging-topic candidate: real supporting quotes from
 * the episodes whose off-taxonomy mentions were clustered into this candidate.
 * Lazy-loaded when a row on /emerging is expanded. Most-recent episode first
 * (this is an "emerging / what they're saying now" board, so freshness leads),
 * one receipt per episode. Quotes are excerpts only, never full transcripts.
 *
 * Public data, read server-side via the service-role client like every read.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface EmergingReceipt {
  /** Transcript excerpt the model flagged. Never the full transcript. */
  quote: string;
  channel: string;
  /** Source channel's editorial lean: "L" | "M" | "R". Colors the receipt chip. */
  lean: string;
  /** Favorability of this quote toward the topic, -5..+5; null when unscored.
   *  A separate axis from the channel lean (how critical vs. celebratory). */
  favorability: number | null;
  episodeTitle: string;
  episodeUrl: string;
  publishedAt: string;
}

export interface EmergingReceiptsResponse {
  receipts: EmergingReceipt[];
}

const MAX_RECEIPTS = 12;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const db = createServiceClient();
  // Optional cohort filter so receipts match the active tab on /emerging.
  const cohortParam = req.nextUrl.searchParams.get("cohort");
  const cohort = cohortParam === "independent" || cohortParam === "legacy" ? cohortParam : null;

  // One candidate's clustered topics carry the supporting quote + episode. A
  // candidate has at most a few hundred topics (< the 1000-row cap), so a single
  // page covers it. !inner so a topic with a missing episode/channel is dropped.
  let q = db
    .from("discovery_topics")
    .select(
      `id, quote,
       episode:episodes!discovery_topics_episode_id_fkey!inner (
         title, source_url, published_at,
         channel:channels!episodes_channel_id_fkey!inner ( name, reach, political_lean, cohort )
       )`,
    )
    .eq("candidate_id", params.id)
    .not("quote", "is", null);
  if (cohort) q = q.eq("episode.channel.cohort", cohort);
  const { data, error } = await q.limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Favorability scores for these mentions (separate fetch keyed on the stable
  // topic id; an overlay, so a failure just leaves favorability null).
  const topicIds = ((data as any[]) || []).map((r) => r.id).filter(Boolean);
  const favByTopic = new Map<string, number>();
  if (topicIds.length > 0) {
    const { data: scoreData } = await db
      .from("discovery_topic_scores")
      .select("discovery_topic_id, favorability")
      .in("discovery_topic_id", topicIds);
    for (const s of (scoreData as any[]) || []) {
      favByTopic.set(s.discovery_topic_id, Number(s.favorability));
    }
  }

  interface Row {
    quote: string;
    channel: string;
    lean: string;
    favorability: number | null;
    episodeTitle: string;
    episodeUrl: string;
    publishedAt: string;
    reach: number;
  }
  const rows: Row[] = [];
  for (const r of (data as any[]) || []) {
    const e = r.episode;
    const ch = e?.channel;
    const quote = (r.quote || "").trim();
    if (!e || !ch || !quote) continue;
    rows.push({
      quote,
      channel: ch.name,
      lean: ch.political_lean || "M",
      favorability: favByTopic.has(r.id) ? (favByTopic.get(r.id) as number) : null,
      episodeTitle: e.title || "(untitled)",
      episodeUrl: e.source_url || "#",
      publishedAt: e.published_at,
      reach: Number(ch.reach) || 0,
    });
  }

  // Most-recent first so the proof matches the "emerging / now" framing - the old
  // reach-first sort buried a topic's fresh quotes under months-old high-reach
  // episodes (a topic active yesterday could show only 2-week-old receipts).
  // Tie-break by reach so the most influential quote leads within a given day.
  rows.sort((a, b) => {
    const ta = new Date(a.publishedAt).getTime();
    const tb = new Date(b.publishedAt).getTime();
    if (tb !== ta) return tb - ta;
    return b.reach - a.reach;
  });
  const seen = new Set<string>();
  const receipts: EmergingReceipt[] = [];
  for (const r of rows) {
    if (seen.has(r.episodeUrl)) continue;
    seen.add(r.episodeUrl);
    receipts.push({
      quote: r.quote,
      channel: r.channel,
      lean: r.lean,
      favorability: r.favorability,
      episodeTitle: r.episodeTitle,
      episodeUrl: r.episodeUrl,
      publishedAt: r.publishedAt,
    });
    if (receipts.length >= MAX_RECEIPTS) break;
  }

  const body: EmergingReceiptsResponse = { receipts };
  return NextResponse.json(body);
}
