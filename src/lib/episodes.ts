/**
 * Episode data for the /log activity table and the per-channel "Recent
 * episodes" table. Reads the `episode_pipeline_summary` view so per-episode
 * classify/score counts are computed in Postgres rather than the app.
 */
import { createServiceClient } from "./db";
import { PUBLIC_COHORTS } from "./cohort";

export type TranscriptStatus = "pending" | "fetched" | "failed" | "skipped";
export type ClassifyStatus = "pending" | "processed" | "failed";

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
  classify_status: ClassifyStatus;
  classification_count: number;
  scored_count: number;
  /** "done" = transcript fetched; "failed" = transcript fetch failed;
   *  "pending" = not yet attempted. */
  transcribed: "done" | "failed" | "pending";
  /** "done" = classified, produced mentions; "no-signal" = classified, no
   *  taxonomy match; "pending" = not yet classified; "na" only when the
   *  prerequisite transcript fetch failed (nothing to classify). */
  classified: "done" | "no-signal" | "pending" | "na";
  /** "done" = all mentions scored; "partial" = some scored; "pending" =
   *  has mentions but none scored yet; "no-signal" = no mentions to score
   *  because the episode was off-taxonomy; "na" when classify is gated. */
  scored: "done" | "partial" | "pending" | "no-signal" | "na";
  cohort: "independent" | "legacy";
}

/** One classified-and-scored issue mention within an episode, for the
 *  expandable "receipts" row on the activity log. */
export interface EpisodeMention {
  issueSlug: string;
  issueName: string;
  /** The exact transcript excerpt the model flagged. Never the full transcript. */
  quote: string;
  /** -5..+5; negative pulls the Index Left, positive Right. Null if unscored. */
  sentiment: number | null;
  /** 1..5 conviction. Null if unscored. */
  intensity: number | null;
}

/** Per-episode classification detail, lazy-loaded when a log row is expanded. */
export interface EpisodeMentionsResponse {
  episodeId: string;
  mentions: EpisodeMention[];
  /** Intensity-weighted net lean across scored mentions (-5..+5), or null. */
  netLean: number | null;
  numIssues: number;
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
        "id, title, published_at, source_url, duration_sec, channel_id, channel_name, political_lean, platform, transcript_status, classify_status, classification_count, scored_count",
      );
    if (channelId) q = q.eq("channel_id", channelId);
    // published_at is the business order (newest first) but isn't unique -
    // two episodes posted in the same second can re-cross page boundaries
    // and appear duplicated in the table. Chain `id` as the stable tiebreaker
    // so pagination is deterministic even when published_at values collide.
    // (See [[pagination-stable-order]] - the missing-tiebreaker subspecies of
    // the v0.6.47 family.)
    const { data, error } = await q
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("getEpisodeTableRows:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
  }

  return rows.slice(0, limit).map(mapEpisodeRow);
}

/** Columns selected from episode_pipeline_summary for the table. */
const EPISODE_SELECT =
  "id, title, published_at, source_url, duration_sec, channel_id, channel_name, political_lean, platform, transcript_status, classify_status, classification_count, scored_count, cohort";

/** Derive the flat EpisodeTableRow (incl. cascade stage states) from a raw
 *  episode_pipeline_summary row. Shared by the full-list and paginated reads. */
function mapEpisodeRow(r: any): EpisodeTableRow {
  const cc = Number(r.classification_count) || 0;
  const sc = Number(r.scored_count) || 0;
  const transcribed: EpisodeTableRow["transcribed"] =
    r.transcript_status === "fetched"
      ? "done"
      : r.transcript_status === "failed"
        ? "failed"
        : "pending";
  // "no-signal" = classified, taxonomy didn't match (~8% of processed
  // episodes - sports, true crime, celebrity, etc.). Distinct from "pending"
  // so readers don't mistake a complete-but-empty result for in-progress
  // work. v0.6.54 - see [[soapbox-roadmap]] no-signal status.
  const classified: EpisodeTableRow["classified"] =
    transcribed === "failed"
      ? "na"
      : r.classify_status === "processed"
        ? cc > 0
          ? "done"
          : "no-signal"
        : "pending";
  // Scored mirrors the upstream stage's reality, in cascade (see the v0.6.54
  // regression guard: classify-pending must stay scored-pending, not fall
  // through to sc>=cc evaluating 0>=0 as "done").
  const scored: EpisodeTableRow["scored"] =
    classified === "na"
      ? "na"
      : classified === "no-signal"
        ? "no-signal"
        : classified === "pending"
          ? "pending"
          : sc >= cc
            ? "done"
            : sc > 0
              ? "partial"
              : "pending";
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
    classify_status: r.classify_status,
    classification_count: cc,
    scored_count: sc,
    transcribed,
    classified,
    scored,
    cohort: r.cohort,
  };
}

/** Server-sortable columns. Stage columns map to their underlying DB field so
 *  ordering is "group by how far it got" (close enough to the client stage
 *  ranking). Anything else falls back to published_at. */
export type EpisodeSortKey =
  | "published_at"
  | "title"
  | "channel_name"
  | "duration_sec"
  | "political_lean"
  | "platform"
  | "transcript_status"
  | "classify_status"
  | "scored_count";

const EPISODE_SORT_KEYS = new Set<EpisodeSortKey>([
  "published_at",
  "title",
  "channel_name",
  "duration_sec",
  "political_lean",
  "platform",
  "transcript_status",
  "classify_status",
  "scored_count",
]);

export interface EpisodeTablePage {
  rows: EpisodeTableRow[];
  /** Total matching rows (across all pages) for the given filters. */
  total: number;
}

/**
 * One page of the episode table, sorted/searched/paginated in Postgres. Backs
 * the server-driven /log table (and channel drill-downs) so the page fetches
 * only the ~50 rows it renders instead of the whole archive - TTFB stays flat
 * as the episode count grows. Returns the page plus the exact total count.
 */
export async function getEpisodeTablePage(opts: {
  channelId?: string;
  q?: string;
  sort?: EpisodeSortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}): Promise<EpisodeTablePage> {
  const {
    channelId,
    q,
    sort = "published_at",
    dir = "desc",
    page = 0,
    pageSize = 50,
  } = opts;
  const sortKey: EpisodeSortKey = EPISODE_SORT_KEYS.has(sort) ? sort : "published_at";
  const ascending = dir === "asc";

  const db = createServiceClient();
  let query = db
    .from("episode_pipeline_summary")
    .select(EPISODE_SELECT, { count: "exact" });

  // Scope to one channel (drill-down, any cohort) OR to the public cohort
  // (the /log feed) so legacy channels' episodes stay hidden until launch.
  if (channelId) query = query.eq("channel_id", channelId);
  else query = query.in("cohort", [...PUBLIC_COHORTS]);

  if (q && q.trim()) {
    // Sanitize before interpolating into the PostgREST or() filter DSL -
    // commas, parens, and wildcards would otherwise change the filter's
    // meaning. Strip them to spaces; ilike still matches on the rest.
    const term = q.trim().replace(/[,()%*\\]/g, " ").trim();
    if (term) {
      query = query.or(`title.ilike.%${term}%,channel_name.ilike.%${term}%`);
    }
  }

  const from = page * pageSize;
  const { data, error, count } = await query
    .order(sortKey, { ascending })
    // Stable tiebreaker so rows don't re-cross page boundaries when the sort
    // key has ties (e.g. same-second published_at).
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(`getEpisodeTablePage: ${error.message}`);

  return { rows: (data || []).map(mapEpisodeRow), total: count ?? 0 };
}
