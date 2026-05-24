/**
 * Episode listing helpers. Used by the per-channel drill-down's
 * "Recent episodes" section and the public /log activity page.
 */
import { createServiceClient } from "./db";

export type TranscriptStatus = "pending" | "fetched" | "failed" | "skipped";

/**
 * Per-episode progress through the four pipeline stages. "na" = not
 * applicable because an upstream stage didn't complete (e.g. can't classify
 * an episode whose transcript failed).
 */
export interface EpisodePipeline {
  transcribed: "done" | "failed" | "pending";
  classified: "done" | "pending" | "na";
  scored: "done" | "partial" | "pending" | "na";
  classificationCount: number;
  scoredCount: number;
}

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
  /** Per-episode pipeline progress; attached by attachPipeline(). */
  pipeline?: EpisodePipeline;
}

/**
 * Enrich a page of episodes with their classify/score progress. Two small
 * lookups scoped to just the episodes on screen — cheap for a 20–50 row page.
 */
async function attachPipeline(
  db: ReturnType<typeof createServiceClient>,
  episodes: EpisodeListItem[],
): Promise<void> {
  if (episodes.length === 0) return;
  const ids = episodes.map((e) => e.id);

  // Classifications for these episodes: classification id -> episode id.
  const { data: clsRows } = await db
    .from("classifications")
    .select("id, episode_id")
    .in("episode_id", ids);
  const clsByEpisode = new Map<string, string[]>();
  for (const c of (clsRows || []) as { id: string; episode_id: string }[]) {
    const arr = clsByEpisode.get(c.episode_id) || [];
    arr.push(c.id);
    clsByEpisode.set(c.episode_id, arr);
  }

  // Which of those classifications have a sentiment score.
  const allClsIds = (clsRows || []).map((c: any) => c.id);
  const scoredSet = new Set<string>();
  if (allClsIds.length > 0) {
    const { data: scoreRows } = await db
      .from("sentiment_scores")
      .select("classification_id")
      .in("classification_id", allClsIds);
    for (const s of (scoreRows || []) as { classification_id: string }[]) {
      scoredSet.add(s.classification_id);
    }
  }

  for (const ep of episodes) {
    const transcribed: EpisodePipeline["transcribed"] =
      ep.transcript_status === "fetched"
        ? "done"
        : ep.transcript_status === "failed"
          ? "failed"
          : "pending";

    const clsIds = clsByEpisode.get(ep.id) || [];
    const classificationCount = clsIds.length;
    const scoredCount = clsIds.filter((id) => scoredSet.has(id)).length;

    const classified: EpisodePipeline["classified"] =
      transcribed === "failed"
        ? "na"
        : classificationCount > 0
          ? "done"
          : "pending";

    const scored: EpisodePipeline["scored"] =
      classificationCount === 0
        ? "na"
        : scoredCount >= classificationCount
          ? "done"
          : scoredCount > 0
            ? "partial"
            : "pending";

    ep.pipeline = { transcribed, classified, scored, classificationCount, scoredCount };
  }
}

interface ListOptions {
  limit?: number;
  offset?: number;
}

/** Flat row shape for the /log data table, derived from the
 *  episode_pipeline_summary view. */
export interface EpisodeTableRow {
  id: string;
  title: string;
  published_at: string;
  source_url: string;
  duration_sec: number | null;
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
 * Rows for the public /log data table. Reads the `episode_pipeline_summary`
 * view (per-episode classify/score counts computed in Postgres) so the page
 * loads a single light result set instead of thousands of join rows.
 * Paginated via .range() to clear the project Max Rows cap.
 */
export async function getEpisodeTableRows(limit = 2000): Promise<EpisodeTableRow[]> {
  const db = createServiceClient();
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0, pages = 0; pages < 50 && rows.length < limit; pages++, from += PAGE) {
    const { data, error } = await db
      .from("episode_pipeline_summary")
      .select(
        "id, title, published_at, source_url, duration_sec, channel_name, political_lean, platform, transcript_status, classification_count, scored_count",
      )
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

  const episodes = (data || []) as EpisodeListItem[];
  await attachPipeline(db, episodes);

  return {
    episodes,
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

  await attachPipeline(db, episodes);

  return { episodes, total: count || 0 };
}
