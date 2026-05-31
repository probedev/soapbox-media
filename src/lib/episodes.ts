/**
 * Episode data for the /log activity table and the per-channel "Recent
 * episodes" table. Reads the `episode_pipeline_summary` view so per-episode
 * classify/score counts are computed in Postgres rather than the app.
 */
import { createServiceClient } from "./db";

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
    // published_at is the business order (newest first) but isn't unique —
    // two episodes posted in the same second can re-cross page boundaries
    // and appear duplicated in the table. Chain `id` as the stable tiebreaker
    // so pagination is deterministic even when published_at values collide.
    // (See [[pagination-stable-order]] — the missing-tiebreaker subspecies of
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

  return rows.slice(0, limit).map((r) => {
    const cc = Number(r.classification_count) || 0;
    const sc = Number(r.scored_count) || 0;
    const transcribed: EpisodeTableRow["transcribed"] =
      r.transcript_status === "fetched"
        ? "done"
        : r.transcript_status === "failed"
          ? "failed"
          : "pending";
    // "no-signal" = classified, taxonomy didn't match (~8% of processed
    // episodes — sports, true crime, celebrity, etc.). Distinct from
    // "pending" so readers don't mistake a complete-but-empty result for
    // in-progress work. v0.6.54 — see [[soapbox-roadmap]] no-signal status.
    const classified: EpisodeTableRow["classified"] =
      transcribed === "failed"
        ? "na"
        : r.classify_status === "processed"
          ? cc > 0
            ? "done"
            : "no-signal"
          : "pending";
    // Scored mirrors the upstream stage's reality, in cascade:
    //   - "na" / "no-signal" inherit from classified (transcript failed, or
    //     classify ran and found nothing to score).
    //   - If classify hasn't run yet (classified === "pending"), scored is
    //     ALSO "pending" — we genuinely can't score what hasn't been
    //     classified. This guard fixes a v0.6.54 regression where the
    //     previous logic fell through to `sc >= cc` with cc===0 and sc===0,
    //     evaluating 0 >= 0 as true and rendering "done" on episodes that
    //     were nowhere near scored. 132 episodes were affected.
    //   - Only when classified === "done" (cc > 0, by construction) does
    //     sc >= cc actually mean "all mentions scored."
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
    };
  });
}
