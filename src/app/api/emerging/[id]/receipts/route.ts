/**
 * Public receipts for one emerging-topic candidate: real supporting quotes from
 * the episodes whose off-taxonomy mentions were clustered into this candidate.
 * Lazy-loaded when a row on /emerging is expanded. Highest-reach episode first,
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
  episodeTitle: string;
  episodeUrl: string;
  publishedAt: string;
}

export interface EmergingReceiptsResponse {
  receipts: EmergingReceipt[];
}

const MAX_RECEIPTS = 12;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const db = createServiceClient();
  // One candidate's clustered topics carry the supporting quote + episode. A
  // candidate has at most a few hundred topics (< the 1000-row cap), so a single
  // page covers it. !inner so a topic with a missing episode/channel is dropped.
  const { data, error } = await db
    .from("discovery_topics")
    .select(
      `quote,
       episode:episodes!discovery_topics_episode_id_fkey!inner (
         title, source_url, published_at,
         channel:channels!episodes_channel_id_fkey!inner ( name, reach, political_lean )
       )`,
    )
    .eq("candidate_id", params.id)
    .not("quote", "is", null)
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  interface Row {
    quote: string;
    channel: string;
    lean: string;
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
      episodeTitle: e.title || "(untitled)",
      episodeUrl: e.source_url || "#",
      publishedAt: e.published_at,
      reach: Number(ch.reach) || 0,
    });
  }

  // Highest-reach first, one receipt per episode, capped to a tidy set.
  rows.sort((a, b) => b.reach - a.reach);
  const seen = new Set<string>();
  const receipts: EmergingReceipt[] = [];
  for (const r of rows) {
    if (seen.has(r.episodeUrl)) continue;
    seen.add(r.episodeUrl);
    receipts.push({
      quote: r.quote,
      channel: r.channel,
      lean: r.lean,
      episodeTitle: r.episodeTitle,
      episodeUrl: r.episodeUrl,
      publishedAt: r.publishedAt,
    });
    if (receipts.length >= MAX_RECEIPTS) break;
  }

  const body: EmergingReceiptsResponse = { receipts };
  return NextResponse.json(body);
}
