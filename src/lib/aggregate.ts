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
  weekStart: string;
  /** -10..+10 — the headline Soapbox Index for the most recent week */
  index: number;
  /** index - previous_week_index */
  delta: number;
  /** last 12 weeks of Soapbox Index, oldest first */
  sparkline: number[];
  /** top issues for the most recent week, sorted by volume desc */
  issues: IssueAggregate[];
  /** issues with the biggest week-over-week lean change, sorted by |delta| */
  movers: IssueMover[];
  numChannels: number;
  numEpisodes: number;
  numClassifications: number;
  lastUpdated: string;
  /** Empty if no sentiment_scores exist yet — the page should render the
   *  placeholder state in that case. */
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
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("sentiment_scores")
      .select(
        `
        sentiment, intensity,
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
    if (data.length < pageSize) break;
  }
  return all;
}

export async function getDashboardData(): Promise<DashboardData> {
  const rows = await fetchScoreRows();
  const lastUpdated = new Date().toISOString();

  if (rows.length === 0) {
    return {
      weekStart: weekStartIso(new Date().toISOString()),
      index: 0,
      delta: 0,
      sparkline: [],
      issues: [],
      movers: [],
      numChannels: 0,
      numEpisodes: 0,
      numClassifications: 0,
      lastUpdated,
      hasData: false,
    };
  }

  // Bucket all rows by week
  const byWeek = new Map<string, ScoreRow[]>();
  for (const r of rows) {
    const w = weekStartIso(r.episode_published_at);
    const arr = byWeek.get(w) || [];
    arr.push(r);
    byWeek.set(w, arr);
  }

  const sortedWeeks = Array.from(byWeek.keys()).sort();
  const currentWeek = sortedWeeks[sortedWeeks.length - 1];
  const prevWeek = sortedWeeks.length >= 2 ? sortedWeeks[sortedWeeks.length - 2] : null;
  const currentRows = byWeek.get(currentWeek) || [];

  // Soapbox Index for current and previous weeks
  const currentLean = weightedLean(currentRows).lean;
  const currentIndex = clamp(currentLean * 2, -10, 10);
  let delta = 0;
  if (prevWeek) {
    const prevLean = weightedLean(byWeek.get(prevWeek) || []).lean;
    const prevIndex = clamp(prevLean * 2, -10, 10);
    delta = currentIndex - prevIndex;
  }

  // 12-week sparkline (oldest first; only weeks with data)
  const last12 = sortedWeeks.slice(-12);
  const sparkline = last12.map((w) => {
    const r = byWeek.get(w) || [];
    return clamp(weightedLean(r).lean * 2, -10, 10);
  });

  // Per-issue aggregation for current week
  const currentByIssue = new Map<string, ScoreRow[]>();
  for (const r of currentRows) {
    const arr = currentByIssue.get(r.issue_slug) || [];
    arr.push(r);
    currentByIssue.set(r.issue_slug, arr);
  }

  // Compute 8-week trend per issue
  const trendWeeks = sortedWeeks.slice(-8);
  function issueTrend(slug: string): number[] {
    return trendWeeks.map((w) => {
      const wRows = (byWeek.get(w) || []).filter((r) => r.issue_slug === slug);
      return clamp(weightedLean(wRows).lean * 2, -10, 10);
    });
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

  // Movers: per-issue current vs previous week
  const movers: IssueMover[] = [];
  if (prevWeek) {
    const prevByIssue = new Map<string, ScoreRow[]>();
    for (const r of byWeek.get(prevWeek) || []) {
      const arr = prevByIssue.get(r.issue_slug) || [];
      arr.push(r);
      prevByIssue.set(r.issue_slug, arr);
    }
    for (const issue of issueAggregates) {
      const prevRs = prevByIssue.get(issue.slug) || [];
      if (prevRs.length === 0) continue;
      const fromLean = clamp(weightedLean(prevRs).lean * 2, -10, 10);
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
    weekStart: currentWeek,
    index: currentIndex,
    delta,
    sparkline,
    issues: issueAggregates,
    movers,
    numChannels: new Set(currentRows.map((r) => r.channel_id)).size,
    numEpisodes: new Set(currentRows.map((r) => r.episode_id)).size,
    numClassifications: currentRows.length,
    lastUpdated,
    hasData: true,
  };
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
