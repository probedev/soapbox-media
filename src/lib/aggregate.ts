/**
 * Aggregation library.
 *
 * Computes the Soapbox Score (per channel × issue × week) and Soapbox Index
 * (aggregate weekly L/R needle) from the raw `sentiment_scores` table.
 *
 * Methodology (published on /methodology):
 *
 *   reach_factor      = log10(max(channel.reach, 10))   // 10M=7, 100K=5, 10K=4
 *   contribution      = sentiment × intensity × reach_factor
 *   weight            = intensity × reach_factor
 *   weighted_lean     = Σ contribution / Σ weight       // weighted-avg sentiment in [-5..+5]
 *   index_normalized  = clip(weighted_lean × 2, -10, +10)
 *
 * Sentiment is already signed by the score model (negative = L-aligned with
 * the issue's left_position; positive = R-aligned). So `direction` is folded
 * into `sentiment` and we don't compute it separately.
 *
 * This file fetches all scored rows once per render and computes everything
 * in JS. With ~1300 rows that's well under 100ms; we'll add caching / a
 * materialized view in v1 once data volume grows.
 */
import { createServiceClient } from "./db";

interface ScoreRow {
  sentiment: number;
  intensity: number;
  issue_slug: string;
  issue_name: string;
  episode_id: string;
  episode_published_at: string;
  channel_id: string;
  channel_name: string;
  channel_lean: "L" | "M" | "R";
  channel_reach: number;
}

export interface IssueAggregate {
  slug: string;
  name: string;
  /** weighted-avg sentiment, normalized to -10..+10 */
  lean: number;
  /** Σ (intensity × reach_factor) — total "share of voice" weight */
  volume: number;
  numClassifications: number;
  /** lean values across last N weeks (oldest first), for mini-sparklines */
  trend: number[];
}

export interface IssueMover {
  slug: string;
  name: string;
  fromLean: number;
  toLean: number;
  delta: number;
}

export interface DashboardData {
  /** ISO end date of the trailing window (today) */
  asOfDate: string;
  /** Days in the trailing window (default 7) */
  windowDays: number;
  /** -10..+10 — Soapbox Index over the trailing window */
  index: number;
  /** index - previous_period_index (same-length window immediately prior) */
  delta: number;
  /** Daily-rolling Index values for last N days, oldest first.
   *  Each value is the Index for a trailing windowDays-long period
   *  ending on that day. Days with no data are skipped. */
  sparkline: number[];
  /** ISO date (YYYY-MM-DD) for each sparkline point — same length and
   *  order as `sparkline`. Used by the chart to label the time range. */
  sparklineDates: string[];
  /** Top issues within the trailing window, sorted by volume desc */
  issues: IssueAggregate[];
  /** Issues with biggest period-over-period lean change, sorted by |delta| */
  movers: IssueMover[];
  numChannels: number;
  numEpisodes: number;
  numClassifications: number;
  lastUpdated: string;
  hasData: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function reachFactor(reach: number): number {
  return Math.log10(Math.max(reach, 10));
}

function weightedLean(rows: ScoreRow[]): { lean: number; weight: number } {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of rows) {
    const rf = reachFactor(r.channel_reach);
    const w = rf * r.intensity;
    weightedSum += w * r.sentiment;
    totalWeight += w;
  }
  return {
    lean: totalWeight > 0 ? weightedSum / totalWeight : 0,
    weight: totalWeight,
  };
}

/** Returns ISO date (YYYY-MM-DD) of the Monday of the week containing `iso`. */
function weekStartIso(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function fetchScoreRows(): Promise<ScoreRow[]> {
  const db = createServiceClient();
  const all: ScoreRow[] = [];
  // Smaller pageSize to keep the deep-join response under Supabase's response
  // size limit. The previous 1000 worked locally but Vercel's edge→Supabase
  // route was returning partial pages, and the old `length < pageSize`
  // terminator interpreted that as end-of-data, silently dropping ~46% of
  // rows in production. See v0.6.3 fix.
  const pageSize = 500;
  // Safety bound so a malformed loop can't hang the request.
  const maxPages = 50;

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await db
      .from("sentiment_scores")
      .select(
        `
        id, sentiment, intensity,
        classification:classifications!sentiment_scores_classification_id_fkey (
          issue_slug, episode_id,
          issue:issues!classifications_issue_slug_fkey ( name ),
          episode:episodes!classifications_episode_id_fkey (
            id, published_at,
            channel:channels!episodes_channel_id_fkey (
              id, name, political_lean, reach
            )
          )
        )
      `,
      )
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetchScoreRows: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data as any[]) {
      const c = r.classification;
      const e = c?.episode;
      const ch = e?.channel;
      if (!c || !e || !ch || !c.issue) continue;
      all.push({
        sentiment: Number(r.sentiment),
        intensity: Number(r.intensity),
        issue_slug: c.issue_slug,
        issue_name: c.issue.name,
        episode_id: c.episode_id,
        episode_published_at: e.published_at,
        channel_id: ch.id,
        channel_name: ch.name,
        channel_lean: ch.political_lean,
        channel_reach: Number(ch.reach),
      });
    }
    // Only terminate when we get a genuinely empty page. A short page
    // (length < pageSize but > 0) does NOT mean we're done — it can just
    // mean Supabase's response-size cap hit before the row cap. Continue
    // paginating until we get an empty result.
  }
  return all;
}

/**
 * Returns dashboard data using a trailing N-day rolling window (default 7).
 * Updated by the daily cron, so the number is always the most recent week's
 * worth of content but stable enough not to whipsaw with each new episode.
 */
export async function getDashboardData(windowDays = 7): Promise<DashboardData> {
  const rows = await fetchScoreRows();
  const lastUpdated = new Date().toISOString();
  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);

  // Total tracked shows + total ingested episodes — used by TrustStrip so
  // its numbers match the SystemStats panel on /channels. Don't conflate
  // these with the in-window classification volume (those are scoped to
  // the rolling 7-day window for Index math).
  const db = createServiceClient();
  const [channelNamesRes, episodesCountRes] = await Promise.all([
    db.from("channels").select("name").eq("active", true).limit(2000),
    db.from("episodes").select("*", { count: "exact", head: true }),
  ]);
  const totalShows = new Set(
    (channelNamesRes.data || []).map((c: { name: string }) => c.name),
  ).size;
  const totalEpisodes = episodesCountRes.count || 0;

  if (rows.length === 0) {
    return {
      asOfDate,
      windowDays,
      index: 0,
      delta: 0,
      sparkline: [],
      sparklineDates: [],
      issues: [],
      movers: [],
      numChannels: totalShows,
      numEpisodes: totalEpisodes,
      numClassifications: 0,
      lastUpdated,
      hasData: false,
    };
  }

  // Helper: rows whose episode falls within [windowStart, windowEnd)
  function rowsInRange(windowStart: Date, windowEnd: Date): ScoreRow[] {
    return rows.filter((r) => {
      const d = new Date(r.episode_published_at);
      return d >= windowStart && d < windowEnd;
    });
  }

  // Current window: last N days ending now
  const currentEnd = now;
  const currentStart = new Date(now);
  currentStart.setUTCDate(currentStart.getUTCDate() - windowDays);
  const currentRows = rowsInRange(currentStart, currentEnd);
  const currentIndex = clamp(weightedLean(currentRows).lean * 2, -10, 10);

  // Previous window: the N days immediately before the current window
  const prevEnd = currentStart;
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - windowDays);
  const prevRows = rowsInRange(prevStart, prevEnd);
  const prevIndex = clamp(weightedLean(prevRows).lean * 2, -10, 10);
  const delta = prevRows.length > 0 ? currentIndex - prevIndex : 0;

  // Sparkline: rolling N-day Index value for each of the last 30 days.
  // We track the ISO date of each point in parallel so the chart can
  // label its actual time range (days with no data are skipped).
  const sparklineLen = 30;
  const sparkline: number[] = [];
  const sparklineDates: string[] = [];
  for (let daysAgo = sparklineLen - 1; daysAgo >= 0; daysAgo--) {
    const windowEnd = new Date(now);
    windowEnd.setUTCDate(windowEnd.getUTCDate() - daysAgo);
    const windowStart = new Date(windowEnd);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);
    const wRows = rowsInRange(windowStart, windowEnd);
    if (wRows.length === 0) continue;
    sparkline.push(clamp(weightedLean(wRows).lean * 2, -10, 10));
    sparklineDates.push(windowEnd.toISOString().slice(0, 10));
  }

  // Per-issue aggregation for current window
  const currentByIssue = new Map<string, ScoreRow[]>();
  for (const r of currentRows) {
    const arr = currentByIssue.get(r.issue_slug) || [];
    arr.push(r);
    currentByIssue.set(r.issue_slug, arr);
  }

  // 8-point issue trend (one point per N-day window stepped daily)
  const trendLen = 8;
  function issueTrend(slug: string): number[] {
    const out: number[] = [];
    for (let daysAgo = trendLen - 1; daysAgo >= 0; daysAgo--) {
      const windowEnd = new Date(now);
      windowEnd.setUTCDate(windowEnd.getUTCDate() - daysAgo);
      const windowStart = new Date(windowEnd);
      windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);
      const wRows = rowsInRange(windowStart, windowEnd).filter(
        (r) => r.issue_slug === slug,
      );
      if (wRows.length === 0) continue;
      out.push(clamp(weightedLean(wRows).lean * 2, -10, 10));
    }
    return out;
  }

  const issueAggregates: IssueAggregate[] = [];
  for (const [slug, rs] of currentByIssue) {
    const { lean, weight } = weightedLean(rs);
    issueAggregates.push({
      slug,
      name: rs[0]?.issue_name || slug,
      lean: clamp(lean * 2, -10, 10),
      volume: Math.round(weight),
      numClassifications: rs.length,
      trend: issueTrend(slug),
    });
  }
  issueAggregates.sort((a, b) => b.volume - a.volume);

  // Movers: per-issue current vs previous window
  const movers: IssueMover[] = [];
  if (prevRows.length > 0) {
    const prevByIssue = new Map<string, ScoreRow[]>();
    for (const r of prevRows) {
      const arr = prevByIssue.get(r.issue_slug) || [];
      arr.push(r);
      prevByIssue.set(r.issue_slug, arr);
    }
    for (const issue of issueAggregates) {
      const prs = prevByIssue.get(issue.slug) || [];
      if (prs.length === 0) continue;
      const fromLean = clamp(weightedLean(prs).lean * 2, -10, 10);
      movers.push({
        slug: issue.slug,
        name: issue.name,
        fromLean,
        toLean: issue.lean,
        delta: issue.lean - fromLean,
      });
    }
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  return {
    asOfDate,
    windowDays,
    index: currentIndex,
    delta,
    sparkline,
    sparklineDates,
    issues: issueAggregates,
    movers,
    // numChannels / numEpisodes are TOTAL tracked counts (not window-scoped),
    // to match the SystemStats banner on /channels. The in-window classification
    // count stays as numClassifications. This keeps numbers consistent across
    // the homepage hero strip and the SystemStats panel.
    numChannels: totalShows,
    numEpisodes: totalEpisodes,
    numClassifications: currentRows.length,
    lastUpdated,
    hasData: true,
  };
}

/**
 * System-wide rollup stats — channel count, episodes processed, hours of
 * audio analyzed, etc. Used on /channels page and other admin/social-proof
 * surfaces. Designed to be cheap: just COUNT(*) queries + a small duration
 * sum, no transcript text fetching.
 */
export interface SystemStats {
  channelsTracked: number;
  episodesAnalyzed: number;
  transcriptsAvailable: number;
  classifications: number;
  sentimentScores: number;
  hoursOfAudio: number;
  /** Estimated from duration × ~150 wpm (natural conversational speech). */
  wordsTranscribedEstimate: number;
  /** Latest sentiment_score.created_at, ISO. Null when no scores yet. */
  lastUpdated: string | null;
}

export async function getSystemStats(): Promise<SystemStats> {
  const db = createServiceClient();

  // Channels: count unique SHOW NAMES (same show on YT + Podcast = 1 show
  // to the user). Fetch names + dedupe in code rather than a COUNT(*).
  const { data: channelNameRows } = await db
    .from("channels")
    .select("name")
    .eq("active", true)
    .limit(2000);
  const uniqueShowCount = new Set(
    (channelNameRows || []).map((c: { name: string }) => c.name),
  ).size;

  const [episodes, transcripts, classifications, scores] = await Promise.all([
    db.from("episodes").select("*", { count: "exact", head: true }),
    db.from("transcripts").select("*", { count: "exact", head: true }),
    db.from("classifications").select("*", { count: "exact", head: true }),
    db.from("sentiment_scores").select("*", { count: "exact", head: true }),
  ]);

  // Fetch duration_sec for all episodes (paginated for safety; ~200 rows so cheap)
  let totalSeconds = 0;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("episodes")
      .select("duration_sec")
      .not("duration_sec", "is", null)
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const e of data) totalSeconds += Number(e.duration_sec) || 0;
    if (data.length < pageSize) break;
  }
  const hoursOfAudio = totalSeconds / 3600;
  // ~150 wpm = 2.5 words/sec for natural speech
  const wordsTranscribedEstimate = Math.round(totalSeconds * 2.5);

  // Latest activity timestamp from sentiment_scores
  const { data: latest } = await db
    .from("sentiment_scores")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastUpdated =
    latest && latest[0]?.created_at ? String(latest[0].created_at) : null;

  return {
    channelsTracked: uniqueShowCount,
    episodesAnalyzed: episodes.count || 0,
    transcriptsAvailable: transcripts.count || 0,
    classifications: classifications.count || 0,
    sentimentScores: scores.count || 0,
    hoursOfAudio,
    wordsTranscribedEstimate,
    lastUpdated,
  };
}

/**
 * Per-issue breakdown of how each issue is pushing the Soapbox Index in the
 * current rolling window. Used by the "Why is the Index where it is?"
 * component on the methodology page (and possibly the homepage).
 */
export interface IssueContribution {
  slug: string;
  name: string;
  numClassifications: number;
  /** Average raw sentiment (-5..+5) across this issue's classifications. */
  avgSentiment: number;
  /** Σ (sentiment × intensity × log10(reach)) — the net push this issue
   *  exerts on the Soapbox Index. Negative = pulls L; positive = pulls R. */
  contribution: number;
  direction: "L" | "R" | "neutral";
}

export interface IndexBreakdown {
  /** Current Soapbox Index in the window (-10..+10). */
  index: number;
  windowDays: number;
  totalClassifications: number;
  /** Issues sorted by |contribution| descending — biggest movers first. */
  issues: IssueContribution[];
}

/**
 * Generate a one-or-two-sentence narrative headline from an IndexBreakdown.
 * Used on the homepage to give the casual visitor "what is driving today's
 * Index" in plain English without our having to write it manually.
 */
export function buildAutoHeadline(breakdown: IndexBreakdown): string {
  if (breakdown.issues.length === 0) return "";

  const formatList = (items: { name: string }[]): string => {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0].name;
    if (items.length === 2) return `${items[0].name} and ${items[1].name}`;
    return `${items[0].name}, ${items[1].name}, and ${items[2].name}`;
  };

  const sortedByVolume = [...breakdown.issues].sort(
    (a, b) => b.numClassifications - a.numClassifications,
  );
  const topVolume = sortedByVolume[0];
  const lIssues = breakdown.issues.filter((i) => i.direction === "L").slice(0, 3);
  const rIssues = breakdown.issues.filter((i) => i.direction === "R").slice(0, 3);

  const parts: string[] = [];

  if (topVolume) {
    parts.push(
      `${topVolume.name} dominated the conversation with ${topVolume.numClassifications.toLocaleString()} mentions.`,
    );
  }

  if (lIssues.length > 0 && rIssues.length > 0) {
    parts.push(
      `Coverage of ${formatList(lIssues)} pulled the Index left, offset by ${formatList(rIssues)} on the right.`,
    );
  } else if (lIssues.length > 0) {
    parts.push(`Coverage of ${formatList(lIssues)} pulled the Index left.`);
  } else if (rIssues.length > 0) {
    parts.push(`Coverage of ${formatList(rIssues)} pushed the Index right.`);
  }

  return parts.join(" ");
}

export async function getIndexBreakdown(windowDays = 30): Promise<IndexBreakdown> {
  const rows = await fetchScoreRows();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const windowed = rows.filter(
    (r) => new Date(r.episode_published_at) >= cutoff,
  );

  if (windowed.length === 0) {
    return { index: 0, windowDays, totalClassifications: 0, issues: [] };
  }

  const byIssue = new Map<string, ScoreRow[]>();
  for (const r of windowed) {
    const arr = byIssue.get(r.issue_slug) || [];
    arr.push(r);
    byIssue.set(r.issue_slug, arr);
  }

  const issues: IssueContribution[] = [];
  for (const [slug, rs] of byIssue) {
    let totalSentiment = 0;
    let totalContribution = 0;
    for (const r of rs) {
      const rf = reachFactor(r.channel_reach);
      totalContribution += r.sentiment * r.intensity * rf;
      totalSentiment += r.sentiment;
    }
    const avgSentiment = totalSentiment / rs.length;
    issues.push({
      slug,
      name: rs[0].issue_name,
      numClassifications: rs.length,
      avgSentiment,
      contribution: totalContribution,
      direction:
        totalContribution > 0.5 ? "R" : totalContribution < -0.5 ? "L" : "neutral",
    });
  }

  issues.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const overallLean = weightedLean(windowed).lean;
  const index = clamp(overallLean * 2, -10, 10);

  return { index, windowDays, totalClassifications: windowed.length, issues };
}

/**
 * Issue drill-down: rank channels by their contribution to this issue this week.
 */
export interface ChannelOnIssue {
  channel_id: string;
  channel_name: string;
  channel_lean: "L" | "M" | "R";
  lean: number;
  numMentions: number;
  weight: number;
}

export interface IssueDrillDown {
  slug: string;
  name: string;
  definition: string;
  leftPosition: string;
  rightPosition: string;
  overallLean: number;
  channels: ChannelOnIssue[];
  numEpisodes: number;
  numClassifications: number;
}

export async function getIssueDrillDown(slug: string): Promise<IssueDrillDown | null> {
  const db = createServiceClient();
  const { data: issue, error: issueErr } = await db
    .from("issues")
    .select("slug, name, definition, left_position, right_position")
    .eq("slug", slug)
    .single();
  if (issueErr || !issue) return null;

  const rows = await fetchScoreRows();
  // Last 30 days for drill-down to give a meaningful sample
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const issueRows = rows.filter(
    (r) =>
      r.issue_slug === slug && new Date(r.episode_published_at) >= cutoff,
  );

  // Group by channel
  const byChannel = new Map<string, ScoreRow[]>();
  for (const r of issueRows) {
    const arr = byChannel.get(r.channel_id) || [];
    arr.push(r);
    byChannel.set(r.channel_id, arr);
  }

  const channels: ChannelOnIssue[] = [];
  for (const [channel_id, rs] of byChannel) {
    const { lean, weight } = weightedLean(rs);
    channels.push({
      channel_id,
      channel_name: rs[0].channel_name,
      channel_lean: rs[0].channel_lean,
      lean: clamp(lean * 2, -10, 10),
      numMentions: rs.length,
      weight: Math.round(weight),
    });
  }
  channels.sort((a, b) => b.weight - a.weight);

  const overall = clamp(weightedLean(issueRows).lean * 2, -10, 10);

  return {
    slug: issue.slug,
    name: issue.name,
    definition: issue.definition,
    leftPosition: issue.left_position,
    rightPosition: issue.right_position,
    overallLean: overall,
    channels,
    numEpisodes: new Set(issueRows.map((r) => r.episode_id)).size,
    numClassifications: issueRows.length,
  };
}

/**
 * Channel drill-down: every issue this channel has covered, with lean + count.
 */
export interface IssueOnChannel {
  issue_slug: string;
  issue_name: string;
  lean: number;
  numMentions: number;
  weight: number;
}

export interface ChannelDrillDown {
  channel_id: string;
  channel_name: string;
  channel_lean: "L" | "M" | "R";
  channel_reach: number;
  netLean: number;
  issues: IssueOnChannel[];
  numEpisodes: number;
  numClassifications: number;
}

export async function getChannelDrillDown(channelId: string): Promise<ChannelDrillDown | null> {
  const db = createServiceClient();
  const { data: channel, error } = await db
    .from("channels")
    .select("id, name, political_lean, reach")
    .eq("id", channelId)
    .single();
  if (error || !channel) return null;

  const rows = await fetchScoreRows();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const channelRows = rows.filter(
    (r) =>
      r.channel_id === channelId && new Date(r.episode_published_at) >= cutoff,
  );

  const byIssue = new Map<string, ScoreRow[]>();
  for (const r of channelRows) {
    const arr = byIssue.get(r.issue_slug) || [];
    arr.push(r);
    byIssue.set(r.issue_slug, arr);
  }

  const issues: IssueOnChannel[] = [];
  for (const [slug, rs] of byIssue) {
    const { lean, weight } = weightedLean(rs);
    issues.push({
      issue_slug: slug,
      issue_name: rs[0].issue_name,
      lean: clamp(lean * 2, -10, 10),
      numMentions: rs.length,
      weight: Math.round(weight),
    });
  }
  issues.sort((a, b) => b.weight - a.weight);

  const netLean = clamp(weightedLean(channelRows).lean * 2, -10, 10);

  return {
    channel_id: channel.id,
    channel_name: channel.name,
    channel_lean: channel.political_lean,
    channel_reach: Number(channel.reach),
    netLean,
    issues,
    numEpisodes: new Set(channelRows.map((r) => r.episode_id)).size,
    numClassifications: channelRows.length,
  };
}
