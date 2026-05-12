/**
 * Episode listing helpers. Used by the per-channel drill-down's
 * "Recent episodes" section and the public /log activity page.
 */
import { createServiceClient } from "./db";

export type TranscriptStatus = "pending" | "fetched" | "failed" | "skipped";

export interface EpisodeListItem {
  id: string;
  title: string;
  published_at: string;
  source_url: string;
  duration_sec: number | null;
  transcript_status: TranscriptStatus;
  /** Present only when the query joins channel info (e.g. /log page). */
  channel?: {
    id: string;
    name: string;
    political_lean: "L" | "M" | "R";
    platform: "youtube" | "podcast";
  };
}

interface ListOptions {
  limit?: number;
  offset?: number;
}

interface ListResult {
  episodes: EpisodeListItem[];
  total: number;
}

/**
 * Episodes for a single channel, ordered by publish date desc.
 */
export async function getEpisodesForChannel(
  channelId: string,
  options: ListOptions = {},
): Promise<ListResult> {
  const db = createServiceClient();
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const { data, count, error } = await db
    .from("episodes")
    .select(
      "id, title, published_at, source_url, duration_sec, transcript_status",
      { count: "exact" },
    )
    .eq("channel_id", channelId)
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("getEpisodesForChannel:", error.message);
    return { episodes: [], total: 0 };
  }

  return {
    episodes: (data || []) as EpisodeListItem[],
    total: count || 0,
  };
}

/**
 * Recent episodes across all channels, joined with channel metadata.
 * Used by the public /log activity page.
 */
export async function getRecentEpisodes(
  options: ListOptions = {},
): Promise<ListResult> {
  const db = createServiceClient();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const { data, count, error } = await db
    .from("episodes")
    .select(
      `
      id, title, published_at, source_url, duration_sec, transcript_status,
      channel:channels!episodes_channel_id_fkey (
        id, name, political_lean, platform
      )
    `,
      { count: "exact" },
    )
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("getRecentEpisodes:", error.message);
    return { episodes: [], total: 0 };
  }

  const episodes = (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    published_at: row.published_at,
    source_url: row.source_url,
    duration_sec: row.duration_sec,
    transcript_status: row.transcript_status,
    channel: row.channel
      ? {
          id: row.channel.id,
          name: row.channel.name,
          political_lean: row.channel.political_lean,
          platform: row.channel.platform,
        }
      : undefined,
  })) as EpisodeListItem[];

  return { episodes, total: count || 0 };
}
