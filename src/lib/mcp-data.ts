/**
 * Data functions backing the public MCP server (/api/mcp). Read-only, all
 * through the service client. Transcript policy: NEVER expose full episode
 * text - mention-level supporting quotes + source links only (same rule as
 * the public site; PodScan/Supadata license transcripts to us, not through
 * us).
 */
import { createServiceClient } from "@/lib/db";
import { timestampedSourceUrl } from "@/lib/transcript-timing";

const MAX_LIMIT = 50;

export interface MentionFilters {
  issue_slug?: string;
  channel_id?: string;
  lean?: ("L" | "M" | "R")[];
  cohort?: "independent" | "legacy";
  platform?: "youtube" | "podcast";
  published_after?: string;
  published_before?: string;
  sentiment_min?: number;
  sentiment_max?: number;
  quote_contains?: string;
  limit?: number;
  offset?: number;
}

export interface MentionRow {
  quote: string;
  sentiment: number;
  intensity: number;
  issue_slug: string;
  issue_name: string;
  episode_title: string;
  published_at: string;
  source_url: string;
  /** Start of the quote in the episode, whole seconds. Null when it couldn't be
   *  located (most podcasts, and YouTube quotes the model paraphrased). */
  start_ts: number | null;
  /** source_url with the timestamp applied where possible (YouTube &t=<s>s).
   *  Equals source_url for podcasts and for mentions with no start_ts. */
  timestamp_url: string;
  channel_id: string;
  channel_name: string;
  channel_lean: string;
  channel_cohort: string;
  channel_platform: string;
}

/**
 * Scored-mention search - the workhorse tool. Every dotted filter path goes
 * through !inner embeds so PostgREST filters parents, not just the embed.
 * Ordering is by scoring recency (stable PK-adjacent key); callers narrow by
 * published_after/before for time control - documented in the tool prompt.
 */
export async function searchMentions(f: MentionFilters): Promise<{ mentions: MentionRow[]; returned: number; offset: number }> {
  const db = createServiceClient();
  const limit = Math.min(Math.max(f.limit ?? 20, 1), MAX_LIMIT);
  const offset = Math.max(f.offset ?? 0, 0);

  let q = db
    .from("sentiment_scores")
    .select(
      `sentiment, intensity, created_at,
       classification:classifications!sentiment_scores_classification_id_fkey!inner (
         supporting_quote, issue_slug, start_ts,
         issue:issues!classifications_issue_slug_fkey!inner ( name ),
         episode:episodes!classifications_episode_id_fkey!inner (
           title, published_at, source_url,
           channel:channels!episodes_channel_id_fkey!inner (
             id, name, political_lean, cohort, platform, active
           )
         )
       )`,
    )
    .eq("classification.episode.channel.active", true);

  if (f.issue_slug) q = q.eq("classification.issue_slug", f.issue_slug);
  if (f.channel_id) q = q.eq("classification.episode.channel.id", f.channel_id);
  if (f.lean?.length) q = q.in("classification.episode.channel.political_lean", f.lean);
  if (f.cohort) q = q.eq("classification.episode.channel.cohort", f.cohort);
  if (f.platform) q = q.eq("classification.episode.channel.platform", f.platform);
  if (f.published_after) q = q.gte("classification.episode.published_at", f.published_after);
  if (f.published_before) q = q.lte("classification.episode.published_at", f.published_before);
  if (f.sentiment_min !== undefined) q = q.gte("sentiment", f.sentiment_min);
  if (f.sentiment_max !== undefined) q = q.lte("sentiment", f.sentiment_max);
  if (f.quote_contains) q = q.ilike("classification.supporting_quote", `%${f.quote_contains}%`);

  const { data, error } = await q
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`searchMentions: ${error.message}`);

  const mentions: MentionRow[] = (data as any[]).map((r) => {
    const c = r.classification;
    const e = c.episode;
    const ch = e.channel;
    const startTs = c.start_ts != null ? Number(c.start_ts) : null;
    return {
      quote: c.supporting_quote,
      sentiment: Number(r.sentiment),
      intensity: Number(r.intensity),
      issue_slug: c.issue_slug,
      issue_name: c.issue?.name ?? c.issue_slug,
      episode_title: e.title,
      published_at: e.published_at,
      source_url: e.source_url,
      start_ts: startTs,
      timestamp_url: timestampedSourceUrl(e.source_url, startTs),
      channel_id: ch.id,
      channel_name: ch.name,
      channel_lean: ch.political_lean,
      channel_cohort: ch.cohort,
      channel_platform: ch.platform,
    };
  });
  return { mentions, returned: mentions.length, offset };
}

export interface TrendBucket {
  week_start: string;
  mentions: number;
  avg_sentiment: number;
  avg_intensity: number;
}

/**
 * Weekly mention-volume + average-sentiment series for one issue. Paginates
 * with stable PK order and empty-page-only termination (see
 * [[pagination-stable-order]] - short pages on deep joins are routine).
 */
export async function issueTrend(
  issueSlug: string,
  windowDays: number,
  cohort?: "independent" | "legacy",
): Promise<{ issue_slug: string; window_days: number; weeks: TrendBucket[] }> {
  const db = createServiceClient();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const pageSize = 1000;
  const maxPages = 20;

  const rows: { sentiment: number; intensity: number; published_at: string }[] = [];
  for (let page = 0; page < maxPages; page++) {
    let q = db
      .from("sentiment_scores")
      .select(
        `id, sentiment, intensity,
         classification:classifications!sentiment_scores_classification_id_fkey!inner (
           issue_slug,
           episode:episodes!classifications_episode_id_fkey!inner (
             published_at,
             channel:channels!episodes_channel_id_fkey!inner ( cohort, active )
           )
         )`,
      )
      .eq("classification.issue_slug", issueSlug)
      .eq("classification.episode.channel.active", true)
      .gte("classification.episode.published_at", cutoff.toISOString());
    if (cohort) q = q.eq("classification.episode.channel.cohort", cohort);
    const { data, error } = await q
      .order("id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`issueTrend: ${error.message}`);
    if (!data || data.length === 0) break; // empty-page-only termination
    for (const r of data as any[]) {
      rows.push({
        sentiment: Number(r.sentiment),
        intensity: Number(r.intensity),
        published_at: r.classification.episode.published_at,
      });
    }
  }

  // Bucket by ISO-ish week (UTC Monday start)
  const buckets = new Map<string, { n: number; s: number; i: number }>();
  for (const r of rows) {
    const d = new Date(r.published_at);
    const day = (d.getUTCDay() + 6) % 7; // Mon=0
    d.setUTCDate(d.getUTCDate() - day);
    const key = d.toISOString().slice(0, 10);
    const b = buckets.get(key) ?? { n: 0, s: 0, i: 0 };
    b.n++; b.s += r.sentiment; b.i += r.intensity;
    buckets.set(key, b);
  }
  const weeks: TrendBucket[] = [...buckets.entries()]
    .sort(([a], [b2]) => a.localeCompare(b2))
    .map(([week_start, b]) => ({
      week_start,
      mentions: b.n,
      avg_sentiment: Number((b.s / b.n).toFixed(2)),
      avg_intensity: Number((b.i / b.n).toFixed(2)),
    }));
  return { issue_slug: issueSlug, window_days: windowDays, weeks };
}

export async function listIssues() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("issues")
    .select("slug, name, definition, left_position, right_position, topic_slug")
    .eq("active", true)
    .order("topic_slug")
    .order("slug");
  if (error) throw new Error(`listIssues: ${error.message}`);
  return data;
}

export async function listChannels() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("channels")
    .select("id, name, platform, political_lean, cohort, reach")
    .eq("active", true)
    .order("reach", { ascending: false });
  if (error) throw new Error(`listChannels: ${error.message}`);
  return data;
}
