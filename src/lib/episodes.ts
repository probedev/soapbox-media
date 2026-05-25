/**
 * Episode data for the /log activity table and the per-channel "Recent
 * episodes" table. Reads the `episode_pipeline_summary` view so per-episode
 * classify/score counts are computed in Postgres rather than the app.
 */
import { createServiceClient } from "./db";

export type TranscriptStatus = "pending" | "fetched" | "failed" | "skipped";

/** Flat row shape for the episode data table, derived from the
 *  episode_pipeline_summary view. */
export interface EpisodeTableRow {
  id: string;
  title: string;
  published_at: string;
  source_url: string;
  duration_sec: number | null;
  channel_id: string;
  channel_name: string;
  political_lean: "L" | "M" | "R";
  platform: "youtube" | "podcast";
  transcript_status: TranscriptStatus;
  classification_count: number;
  scored_count: number;
  transcribed: "done" | "failed" | "pending";
  classified: "done" | "pending" | "na";
  scored: "done" | "partial" | "pending" | "na";
}

/**
 * Rows for the episode data table (the public /log page and channel
 * drill-downs). Reads the `episode_pipeline_summary` view (per-episode
 * classify/score counts computed in Postgres) so the page loads a single
 * light result set instead of thousands of join rows. Paginated via .range()
 * to clear the project Max Rows cap. Pass a channelId to scope to one channel.
 */
export async function getEpisodeTableRows(
  limit = 2000,
  channelId?: string,
): Promise<EpisodeTableRow[]> {
  const db = createServiceClient();
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0, pages = 0; pages < 50 && rows.length < limit; pages++, from += PAGE) {
    let q = db
      .from("episode_pipeline_summary")
      .select(
        "id, title, published_at, source_url, duration_sec, channel_id, channel_name, political_lean, platform, transcript_status, classification_count, scored_count",
      );
    if (channelId) q = q.eq("channel_id", channelId);
    const { data, error } = await q
      .order("published_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("getEpisodeTableRows:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
  }

  return rows.slice(0, limit).map((r) => {
    const cc = Number(r.classification_count) || 0;
    const sc = Number(r.scored_count) || 0;
    const transcribed: EpisodeTableRow["transcribed"] =
      r.transcript_status === "fetched"
        ? "done"
        : r.transcript_status === "failed"
          ? "failed"
          : "pending";
    const classified: EpisodeTableRow["classified"] =
      transcribed === "failed" ? "na" : cc > 0 ? "done" : "pending";
    const scored: EpisodeTableRow["scored"] =
      cc === 0 ? "na" : sc >= cc ? "done" : sc > 0 ? "partial" : "pending";
    return {
      id: r.id,
      title: r.title,
      published_at: r.published_at,
      source_url: r.source_url,
      duration_sec: r.duration_sec,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      political_lean: r.political_lean,
      platform: r.platform,
      transcript_status: r.transcript_status,
      classification_count: cc,
      scored_count: sc,
      transcribed,
      classified,
      scored,
    };
  });
}
