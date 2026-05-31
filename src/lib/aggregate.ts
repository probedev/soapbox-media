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
import { cache as reactCache } from "react";
import { createServiceClient } from "./db";

/**
 * Per-request memoization wrapper. React's `cache()` only exists inside the
 * Next.js server runtime; in a plain Node/tsx CLI context (e.g.
 * `npm run refresh:snapshot`) the import resolves to `undefined`. Fall back to
 * an identity wrapper there — the CLI just runs without cross-call dedup, which
 * is correct (it's a single short-lived process), while server requests keep
 * the real per-render memoization that makes the double home-page call share
 * one DB pass.
 */
const cache: typeof reactCache =
  typeof reactCache === "function" ? reactCache : (fn) => fn;

interface ScoreRow {
  sentiment: number;
  intensity: number;
  issue_slug: string;
  issue_name: string;
  issue_topic_slug: string | null;
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
  /** Raw mention count in the current window. */
  currentMentions: number;
  /** Raw mention count in the parallel prior window. */
  prevMentions: number;
  /** currentMentions / prevMentions — week-over-week volume ratio.
   *  >1 = attention rising, <1 = falling. Paired with `delta` so a row can
   *  earn its spot on either axis: a lean swing, a volume swing, or both. */
  volumeRatio: number;
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

/**
 * Rolling lean trend for a row subset: one point per day for the last `points`
 * days, each the trailing `windowDays`-day weighted lean normalized to −10..+10.
 * Days with no rows are skipped. Same shape the home-page sparkline uses, so it
 * feeds <IndexAreaChart> directly. Scope the `rows` to a single issue or channel
 * before calling to get that entity's trend.
 */
function rollingLeanTrend(
  rows: ScoreRow[],
  now: Date,
  windowDays = 7,
  points = 30,
): { values: number[]; dates: string[] } {
  const values: number[] = [];
  const dates: string[] = [];
  for (let daysAgo = points - 1; daysAgo >= 0; daysAgo--) {
    const windowEnd = new Date(now);
    windowEnd.setUTCDate(windowEnd.getUTCDate() - daysAgo);
    const windowStart = new Date(windowEnd);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);
    const wRows = rows.filter((r) => {
      const d = new Date(r.episode_published_at);
      return d >= windowStart && d < windowEnd;
    });
    if (wRows.length === 0) continue;
    values.push(clamp(weightedLean(wRows).lean * 2, -10, 10));
    dates.push(windowEnd.toISOString().slice(0, 10));
  }
  return { values, dates };
}

/**
 * Rolling mention-count trend for a row subset: one point per day for the
 * last `points` days, each the trailing `windowDays`-day raw mention count.
 *
 * Unlike `rollingLeanTrend`, which skips days where the window is empty
 * (lean is undefined at 0/0), this *keeps* mid-series zero days — a stretch
 * of zero is a real "issue went silent" signal worth seeing on the chart.
 * Leading zeros are trimmed so the line starts at first observed activity.
 *
 * Feeds <VolumeAreaChart> directly. Scope the `rows` to a single issue or
 * channel before calling to get that entity's attention trend.
 */
function rollingVolumeTrend(
  rows: ScoreRow[],
  now: Date,
  windowDays = 7,
  points = 30,
): { values: number[]; dates: string[] } {
  const values: number[] = [];
  const dates: string[] = [];
  for (let daysAgo = points - 1; daysAgo >= 0; daysAgo--) {
    const windowEnd = new Date(now);
    windowEnd.setUTCDate(windowEnd.getUTCDate() - daysAgo);
    const windowStart = new Date(windowEnd);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);
    let count = 0;
    for (const r of rows) {
      const d = new Date(r.episode_published_at);
      if (d >= windowStart && d < windowEnd) count += 1;
    }
    values.push(count);
    dates.push(windowEnd.toISOString().slice(0, 10));
  }
  // Trim leading zero-days only — the entity wasn't being discussed yet.
  // Mid-series zeros stay; that's the silence signal.
  let firstNonZero = 0;
  while (firstNonZero < values.length && values[firstNonZero] === 0) firstNonZero++;
  return {
    values: values.slice(firstNonZero),
    dates: dates.slice(firstNonZero),
  };
}

/**
 * Wrapped with React `cache()` so multiple server-component callers on the
 * same render share one underlying fetch. The home page is the canonical
 * hot path: `<HomePage>` calls `getDashboardData()` and the sibling
 * `<IssueContributionsChart>` server component calls `getIndexBreakdown()`
 * — both rely on this function. Without `cache()` they each paginated the
 * full 17K-row deep-join independently, adding ~7s to TTFB (v0.6.60
 * measured 15s home TTFB pre-fix). Per-render scope only — does NOT bridge
 * separate requests.
 *
 * Page size bumped 500 → 1000 in v0.6.60. The 500 cap was added in v0.6.3
 * because Vercel's edge→Supabase route returns short pages on big response
 * payloads — but v0.6.51 fixed the terminator to only stop on empty pages,
 * so a short page no longer truncates silently. 1000 halves round-trip
 * count (17 pages instead of 34). The select payload per row is small
 * (~300 bytes — IDs + a few short fields, no text), so a full 1000-row
 * page is ~300KB; comfortably under the response cap.
 */
const fetchScoreRows = cache(async (): Promise<ScoreRow[]> => {
  const db = createServiceClient();
  const all: ScoreRow[] = [];
  const pageSize = 1000;
  // Safety bound so a malformed loop can't hang the request. 50 pages ×
  // 1000 rows = 50K-row ceiling; current panel is 17K, headroom for 3×.
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
          issue:issues!classifications_issue_slug_fkey ( name, topic_slug ),
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
        issue_topic_slug: c.issue.topic_slug ?? null,
        episode_id: c.episode_id,
        episode_published_at: e.published_at,
        channel_id: ch.id,
        channel_name: ch.name,
        channel_lean: ch.political_lean,
        channel_reach: Number(ch.reach),
      });
    }
    // Empty-page-only termination — see [[pagination-stable-order]] for
    // why a short page (length < pageSize, > 0) is normal on this route.
  }
  return all;
});

/**
 * Minimum mentions an issue needs in BOTH the current and prior window to be
 * eligible as a "biggest mover". Without this, a quiet week (few mentions) can
 * produce a large, noisy lean swing and grab the headline on a thin sample —
 * e.g. an 18-mention week outranking a 400-mention one. The lean swing is only
 * trustworthy once each side of the comparison has enough rows behind it.
 * The same floor applies to the volume-swing axis: a 4 → 12 mention spike is
 * mathematically a 3× rise but well within noise.
 */
const MOVER_MIN_MENTIONS = 25;

/**
 * Movers eligibility OR-rule thresholds. A row earns its spot if EITHER the
 * lean shifted by at least `MOVER_LEAN_DELTA_FLOOR` OR mention volume rose
 * past `MOVER_VOLUME_RATIO_UP` / fell below `MOVER_VOLUME_RATIO_DOWN`.
 * Tuned so 0.5 lean swing (≈ smallest visible step in the L+/R+ display) and
 * a 1.5× / 0.67× volume swing are roughly comparable "interesting" magnitudes.
 */
const MOVER_LEAN_DELTA_FLOOR = 0.5;
const MOVER_VOLUME_RATIO_UP = 1.5;
const MOVER_VOLUME_RATIO_DOWN = 1 / MOVER_VOLUME_RATIO_UP; // ≈ 0.667

/**
 * Cap on the number of movers shown. Set on the aggregate side (not at the
 * call site) so every surface that consumes `DashboardData.movers` agrees
 * on the leaderboard length.
 */
const MOVER_MAX_ROWS = 6;

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

  // Movers: per-issue current vs previous window.
  // A row earns its place if EITHER the lean swung OR mention volume swung —
  // two orthogonal "biggest mover" signals shown side by side. The lean side
  // answers "did anyone change their mind?"; the volume side answers "did the
  // agenda shift?" An issue can spike in attention with stable lean (Iran
  // breaking news) or drift L↔R while volume stays flat — both are worth
  // surfacing.
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
      // Require enough mentions on BOTH sides of the comparison; a thin window
      // makes both the lean swing and the volume ratio too noisy to headline.
      if (
        issue.numClassifications < MOVER_MIN_MENTIONS ||
        prs.length < MOVER_MIN_MENTIONS
      )
        continue;
      const fromLean = clamp(weightedLean(prs).lean * 2, -10, 10);
      const delta = issue.lean - fromLean;
      const volumeRatio = issue.numClassifications / prs.length;
      const leanInteresting = Math.abs(delta) >= MOVER_LEAN_DELTA_FLOOR;
      const volumeInteresting =
        volumeRatio >= MOVER_VOLUME_RATIO_UP ||
        volumeRatio <= MOVER_VOLUME_RATIO_DOWN;
      if (!leanInteresting && !volumeInteresting) continue;
      movers.push({
        slug: issue.slug,
        name: issue.name,
        fromLean,
        toLean: issue.lean,
        delta,
        currentMentions: issue.numClassifications,
        prevMentions: prs.length,
        volumeRatio,
      });
    }
    // Rank by max(|leanΔ|/2, |log2(volumeRatio)|): each axis scaled so a
    // 2-point lean swing and a 2× volume swing carry equal ranking weight.
    // log2 keeps "doubled" and "halved" symmetric (both score 1.0).
    movers.sort((a, b) => {
      const scoreA = Math.max(
        Math.abs(a.delta) / 2,
        Math.abs(Math.log2(a.volumeRatio)),
      );
      const scoreB = Math.max(
        Math.abs(b.delta) / 2,
        Math.abs(Math.log2(b.volumeRatio)),
      );
      return scoreB - scoreA;
    });
    if (movers.length > MOVER_MAX_ROWS) movers.length = MOVER_MAX_ROWS;
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
  /** Unique shows (same show on YT + Podcast counts once). */
  channelsTracked: number;
  /** Unique-show counts split by editorial lean. */
  channelsByLean: { L: number; M: number; R: number };
  /** Sum of unique-show reach (max reach per show across its platform rows).
   *  Counted by unique show so a dual-platform show isn't double-counted —
   *  one human who follows Ben Shapiro on YT AND podcast is one audience
   *  unit, not two. (The Index math still uses per-row reach for weighting;
   *  this stat is the public-facing "how big is the panel?" number.) */
  audienceReach: number;
  /** Unique-show reach split by editorial lean — sums to audienceReach. */
  audienceReachByLean: { L: number; M: number; R: number };
  /** Number of active issues in the taxonomy (drives the "across N issues"
   *  sublabel on /log — dynamic so it doesn't go stale as taxonomy grows). */
  activeIssues: number;
  /** Total episodes ever ingested (any transcript status). */
  episodesIngested: number;
  /** Episodes with a transcript on file — the ones actually analyzable. */
  episodesAnalyzed: number;
  classifications: number;
  sentimentScores: number;
  hoursOfAudio: number;
  /** Earliest episode ingest timestamp (when continuous tracking began), ISO. */
  coverageSinceISO: string | null;
  /** Latest sentiment_score.created_at, ISO — the newest data point. */
  lastUpdated: string | null;
}

/**
 * Panel-specific stats — composition of the channel set we track, NOT what
 * the pipeline has done with it. Lives on `/channels`, separate from
 * `getSystemStats` (which is processing-scale and lives on `/log`). Sharing
 * the channels query would marginally save a round trip, but the SoC
 * boundary keeps each page's data layer narrow and intentional.
 */
export interface PanelStats {
  /** Unique shows (collapsed by name). */
  showsTracked: number;
  channelsByLean: { L: number; M: number; R: number };
  /** Sum of unique-show reach (max per show across platform rows). */
  audienceReach: number;
  audienceReachByLean: { L: number; M: number; R: number };
  /** Raw active channel rows — each (show, platform) is its own row. */
  platformRows: number;
  /** Per-platform breakdown of `platformRows`. */
  platformSplit: { youtube: number; podcast: number };
  /** Largest single show by max reach across its platforms. */
  largestShow: { name: string; reach: number } | null;
  /** MAX(reach_updated_at) across active channels — when the most-recently-
   *  refreshed channel was last synced. Earliest channel's reach_updated_at
   *  is the floor (worst-case staleness); MAX is the headline freshness. */
  lastReachSync: string | null;
  /** MIN(reach_updated_at) — the oldest reach number still in the panel.
   *  Useful for "as old as X ago" reader signals. */
  oldestReachSync: string | null;
}

export async function getPanelStats(): Promise<PanelStats> {
  const db = createServiceClient();
  const { data: channelRows } = await db
    .from("channels")
    .select("name, political_lean, reach, platform, reach_updated_at")
    .eq("active", true)
    .limit(2000);
  const rows = (channelRows || []) as {
    name: string;
    political_lean: "L" | "M" | "R";
    reach: number | string | null;
    platform: "youtube" | "podcast";
    reach_updated_at: string | null;
  }[];

  // Unique-show map keyed by name; lean is consistent across a show's rows,
  // reach is the MAX across platform rows (same audience often follows both).
  const showRows = new Map<string, { lean: "L" | "M" | "R"; reach: number }>();
  const platformSplit = { youtube: 0, podcast: 0 };
  for (const c of rows) {
    const r = Number(c.reach || 0);
    const prev = showRows.get(c.name);
    if (!prev || r > prev.reach) {
      showRows.set(c.name, { lean: c.political_lean, reach: r });
    }
    platformSplit[c.platform] += 1;
  }
  const channelsByLean = { L: 0, M: 0, R: 0 };
  const audienceReachByLean = { L: 0, M: 0, R: 0 };
  let largest: { name: string; reach: number } | null = null;
  for (const [name, v] of showRows) {
    channelsByLean[v.lean] += 1;
    audienceReachByLean[v.lean] += v.reach;
    if (!largest || v.reach > largest.reach) largest = { name, reach: v.reach };
  }
  // Reach-freshness bookends: most-recent and oldest refresh timestamps
  // across the active panel. /channels displays the most-recent one as
  // "last refreshed" — readers' best signal of how live the numbers are.
  let lastReachSync: string | null = null;
  let oldestReachSync: string | null = null;
  for (const c of rows) {
    if (!c.reach_updated_at) continue;
    if (!lastReachSync || c.reach_updated_at > lastReachSync) lastReachSync = c.reach_updated_at;
    if (!oldestReachSync || c.reach_updated_at < oldestReachSync) oldestReachSync = c.reach_updated_at;
  }

  return {
    showsTracked: showRows.size,
    channelsByLean,
    audienceReach:
      audienceReachByLean.L + audienceReachByLean.M + audienceReachByLean.R,
    audienceReachByLean,
    platformRows: rows.length,
    platformSplit,
    largestShow: largest,
    lastReachSync,
    oldestReachSync,
  };
}

export async function getSystemStats(): Promise<SystemStats> {
  const db = createServiceClient();

  // Channels: collapse same-name rows (YT + Podcast of one show = one show)
  // and count unique shows overall and per lean. A show's lean is consistent
  // across its platform rows, so first-seen lean per name is canonical.
  // Also fetch `reach` so we can sum unique-show audience for the /log stats
  // panel — same collapse rule (max reach per show, not sum, since the same
  // followers often appear on both platforms).
  const { data: channelRows } = await db
    .from("channels")
    .select("name, political_lean, reach")
    .eq("active", true)
    .limit(2000);
  const showRows = new Map<string, { lean: "L" | "M" | "R"; reach: number }>();
  for (const c of (channelRows || []) as {
    name: string;
    political_lean: "L" | "M" | "R";
    reach: number | string | null;
  }[]) {
    const r = Number(c.reach || 0);
    const prev = showRows.get(c.name);
    if (!prev || r > prev.reach) {
      showRows.set(c.name, { lean: c.political_lean, reach: r });
    }
  }
  const channelsByLean = { L: 0, M: 0, R: 0 };
  const audienceReachByLean = { L: 0, M: 0, R: 0 };
  for (const { lean, reach } of showRows.values()) {
    channelsByLean[lean] += 1;
    audienceReachByLean[lean] += reach;
  }
  const uniqueShowCount = showRows.size;
  const audienceReach =
    audienceReachByLean.L + audienceReachByLean.M + audienceReachByLean.R;

  const [episodes, transcripts, classifications, scores, issues] = await Promise.all([
    db.from("episodes").select("*", { count: "exact", head: true }),
    db.from("transcripts").select("*", { count: "exact", head: true }),
    db.from("classifications").select("*", { count: "exact", head: true }),
    db.from("sentiment_scores").select("*", { count: "exact", head: true }),
    db.from("issues").select("*", { count: "exact", head: true }).eq("active", true),
  ]);

  // Sum episode durations, paginated. Terminate only on an empty page and
  // advance by the actual rows returned — robust regardless of the project's
  // Max Rows cap (a fixed `data.length < pageSize` break can stop early).
  let totalSeconds = 0;
  const pageSize = 1000;
  for (let from = 0, pages = 0; pages < 500; pages++, from += pageSize) {
    const { data, error } = await db
      .from("episodes")
      .select("duration_sec")
      .not("duration_sec", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const e of data) totalSeconds += Number(e.duration_sec) || 0;
  }
  const hoursOfAudio = totalSeconds / 3600;

  // Earliest ingest timestamp = when continuous tracking began.
  const { data: earliest } = await db
    .from("episodes")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1);
  const coverageSinceISO =
    earliest && earliest[0]?.created_at ? String(earliest[0].created_at) : null;

  // Newest data point from sentiment_scores.
  const { data: latest } = await db
    .from("sentiment_scores")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastUpdated =
    latest && latest[0]?.created_at ? String(latest[0].created_at) : null;

  return {
    channelsTracked: uniqueShowCount,
    channelsByLean,
    audienceReach,
    audienceReachByLean,
    activeIssues: issues.count || 0,
    episodesIngested: episodes.count || 0,
    episodesAnalyzed: transcripts.count || 0,
    classifications: classifications.count || 0,
    sentimentScores: scores.count || 0,
    hoursOfAudio,
    coverageSinceISO,
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

/* ------------------------------------------------------------------------- *
 * Home-page snapshot
 *
 * The home page renders getDashboardData() + getIndexBreakdown(), both of
 * which paginate the full sentiment_scores deep join via fetchScoreRows. With
 * `force-dynamic` that recomputed on every request (~9.5-15s TTFB). The data
 * only changes when the daily pipeline runs, so we precompute the aggregate
 * once at the end of the score cron and store it in the `dashboard_snapshot`
 * table (one JSON row). The home page reads that single row instead.
 * ------------------------------------------------------------------------- */

/** Everything the home page needs, computed together so the heavy join runs
 *  once. `dashboard` drives the hero/movers/issues; `breakdown` drives the
 *  "Why is the Index where it is?" contribution chart. */
export interface HomeSnapshot {
  dashboard: DashboardData;
  breakdown: IndexBreakdown;
}

/** Stable per-window key for the home snapshot row (e.g. `home:7`). */
function homeSnapshotKey(windowDays: number): string {
  return `home:${windowDays}`;
}

/**
 * Recompute the full home-page aggregate and persist it to dashboard_snapshot.
 * getDashboardData + getIndexBreakdown both call fetchScoreRows, which is
 * React-`cache()`'d per request, so the ~17K-row deep join runs exactly ONCE
 * per invocation. Called at the end of the score cron (the last data-producing
 * stage) so the expensive work happens off the request path; also safe to call
 * ad hoc (e.g. `npm run refresh:snapshot`) to force an immediate refresh.
 */
export async function writeHomeSnapshot(windowDays = 7): Promise<HomeSnapshot> {
  // Sequential (not Promise.all) so the first call populates the per-request
  // fetchScoreRows cache and the second reuses it — one DB pass, not two.
  const dashboard = await getDashboardData(windowDays);
  const breakdown = await getIndexBreakdown(windowDays);
  const snapshot: HomeSnapshot = { dashboard, breakdown };

  const db = createServiceClient();
  const { error } = await db.from("dashboard_snapshot").upsert(
    {
      key: homeSnapshotKey(windowDays),
      payload: snapshot,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(`writeHomeSnapshot: ${error.message}`);
  return snapshot;
}

/**
 * Read the precomputed home snapshot. Returns null when no snapshot exists yet
 * (e.g. right after first deploy, before the first cron run) so callers can
 * fall back to the live getDashboardData/getIndexBreakdown path.
 */
export async function readHomeSnapshot(
  windowDays = 7,
): Promise<HomeSnapshot | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("dashboard_snapshot")
    .select("payload")
    .eq("key", homeSnapshotKey(windowDays))
    .maybeSingle();
  if (error) throw new Error(`readHomeSnapshot: ${error.message}`);
  return (data?.payload as HomeSnapshot) ?? null;
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
  /** Rolling lean trend for <IndexAreaChart> (oldest first). */
  trend: { values: number[]; dates: string[] };
  /** Rolling 7-day mention-count trend for <VolumeAreaChart> (oldest first).
   *  Same window cadence as `trend`, so the lean and attention sparklines
   *  read as a paired story on the issue page. */
  volumeTrend: { values: number[]; dates: string[] };
}

/**
 * Score rows scoped to a single drill-down (one issue, one topic's issues, or
 * one channel's episodes). Unlike fetchScoreRows (which pulls the whole ~17K-row
 * join for global aggregates), this anchors on `classifications` and filters at
 * the DB via an indexed column (`issue_slug` / `episode_id`), so a drill-down
 * page returns only its own slice — tens-to-hundreds of rows — instead of the
 * whole table. This is the fix for ~7s drill-down TTFBs (the pages used
 * fetchScoreRows + a JS filter). Returns the same ScoreRow shape as
 * fetchScoreRows; only scored classifications are included.
 */
type ScoreRowFilter =
  | { kind: "issue"; issueSlug: string }
  | { kind: "issues"; issueSlugs: string[] }
  | { kind: "episodes"; episodeIds: string[] };

async function fetchScoreRowsFiltered(filter: ScoreRowFilter): Promise<ScoreRow[]> {
  if (
    (filter.kind === "issues" && filter.issueSlugs.length === 0) ||
    (filter.kind === "episodes" && filter.episodeIds.length === 0)
  ) {
    return [];
  }

  const db = createServiceClient();
  const all: ScoreRow[] = [];
  const pageSize = 1000;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    let q = db.from("classifications").select(
      `
      id, issue_slug, episode_id,
      issue:issues!classifications_issue_slug_fkey ( name, topic_slug ),
      episode:episodes!classifications_episode_id_fkey (
        id, published_at,
        channel:channels!episodes_channel_id_fkey ( id, name, political_lean, reach )
      ),
      score:sentiment_scores!sentiment_scores_classification_id_fkey ( sentiment, intensity )
      `,
    );
    if (filter.kind === "issue") q = q.eq("issue_slug", filter.issueSlug);
    else if (filter.kind === "issues") q = q.in("issue_slug", filter.issueSlugs);
    else q = q.in("episode_id", filter.episodeIds);

    // Stable PK order + empty-page-only termination (the canonical pagination
    // pattern — see [[pagination-stable-order]]).
    const { data, error } = await q
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetchScoreRowsFiltered: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data as any[]) {
      const score = Array.isArray(r.score) ? r.score[0] : r.score;
      const e = Array.isArray(r.episode) ? r.episode[0] : r.episode;
      const iss = Array.isArray(r.issue) ? r.issue[0] : r.issue;
      const ch = e && (Array.isArray(e.channel) ? e.channel[0] : e.channel);
      // Only scored classifications become ScoreRows (mirrors fetchScoreRows,
      // which starts from sentiment_scores).
      if (!score || !e || !ch || !iss) continue;
      all.push({
        sentiment: Number(score.sentiment),
        intensity: Number(score.intensity),
        issue_slug: r.issue_slug,
        issue_name: iss.name,
        issue_topic_slug: iss.topic_slug ?? null,
        episode_id: r.episode_id,
        episode_published_at: e.published_at,
        channel_id: ch.id,
        channel_name: ch.name,
        channel_lean: ch.political_lean,
        channel_reach: Number(ch.reach),
      });
    }
  }
  return all;
}

/** Every episode id for a channel (paginated past the 1000-row cap). */
async function fetchChannelEpisodeIds(
  db: ReturnType<typeof createServiceClient>,
  channelId: string,
): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 50; page++) {
    const from = page * pageSize;
    const { data, error } = await db
      .from("episodes")
      .select("id")
      .eq("channel_id", channelId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetchChannelEpisodeIds: ${error.message}`);
    if (!data || data.length === 0) break;
    ids.push(...data.map((r: { id: string }) => r.id));
  }
  return ids;
}

export async function getIssueDrillDown(slug: string): Promise<IssueDrillDown | null> {
  const db = createServiceClient();
  const { data: issue, error: issueErr } = await db
    .from("issues")
    .select("slug, name, definition, left_position, right_position")
    .eq("slug", slug)
    .single();
  if (issueErr || !issue) return null;

  // Only this issue's score rows (DB-filtered on the indexed issue_slug),
  // not the whole table. The downstream `r.issue_slug === slug` filters below
  // are then no-ops on this already-scoped set.
  const rows = await fetchScoreRowsFiltered({ kind: "issue", issueSlug: slug });
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

  // Trend uses all rows for this issue (the helpers themselves window to the
  // last ~37 days), independent of the 30-day leaderboard slice above. The
  // single `.filter` is reused so we walk the score-rows array once.
  const issueAllRows = rows.filter((r) => r.issue_slug === slug);
  const trend = rollingLeanTrend(issueAllRows, new Date());
  const volumeTrend = rollingVolumeTrend(issueAllRows, new Date());

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
    trend,
    volumeTrend,
  };
}

/**
 * Topic drill-down: a parent Topic's lean rolled up from its child issues, with
 * each child issue's own lean. Same weighting as the Index (reach × intensity),
 * so a Topic's lean is consistent with its issues and the overall number.
 */
export interface IssueOnTopic {
  issue_slug: string;
  issue_name: string;
  lean: number;
  numMentions: number;
  weight: number;
}

export interface TopicDrillDown {
  slug: string;
  name: string;
  description: string;
  overallLean: number;
  issues: IssueOnTopic[];
  numEpisodes: number;
  numClassifications: number;
  trend: { values: number[]; dates: string[] };
}

export async function getTopicDrillDown(slug: string): Promise<TopicDrillDown | null> {
  const db = createServiceClient();
  const { data: topic, error } = await db
    .from("topics")
    .select("slug, name, description")
    .eq("slug", slug)
    .single();
  if (error || !topic) return null;

  // Resolve the topic's child issues, then pull only their score rows
  // (DB-filtered on issue_slug) instead of the whole table.
  const { data: topicIssues } = await db
    .from("issues")
    .select("slug")
    .eq("topic_slug", slug);
  const issueSlugs = (topicIssues || []).map((i: { slug: string }) => i.slug);
  const rows = await fetchScoreRowsFiltered({ kind: "issues", issueSlugs });
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const topicRows = rows.filter(
    (r) => r.issue_topic_slug === slug && new Date(r.episode_published_at) >= cutoff,
  );

  const byIssue = new Map<string, ScoreRow[]>();
  for (const r of topicRows) {
    const arr = byIssue.get(r.issue_slug) || [];
    arr.push(r);
    byIssue.set(r.issue_slug, arr);
  }
  const issues: IssueOnTopic[] = [];
  for (const [issue_slug, rs] of byIssue) {
    const { lean, weight } = weightedLean(rs);
    issues.push({
      issue_slug,
      issue_name: rs[0].issue_name,
      lean: clamp(lean * 2, -10, 10),
      numMentions: rs.length,
      weight: Math.round(weight),
    });
  }
  issues.sort((a, b) => b.weight - a.weight);

  const overall = clamp(weightedLean(topicRows).lean * 2, -10, 10);
  const trend = rollingLeanTrend(
    rows.filter((r) => r.issue_topic_slug === slug),
    new Date(),
  );

  return {
    slug: topic.slug,
    name: topic.name,
    description: topic.description,
    overallLean: overall,
    issues,
    numEpisodes: new Set(topicRows.map((r) => r.episode_id)).size,
    numClassifications: topicRows.length,
    trend,
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
  /** Rolling net-lean trend for <IndexAreaChart> (oldest first). */
  trend: { values: number[]; dates: string[] };
}

export async function getChannelDrillDown(channelId: string): Promise<ChannelDrillDown | null> {
  const db = createServiceClient();
  const { data: channel, error } = await db
    .from("channels")
    .select("id, name, political_lean, reach")
    .eq("id", channelId)
    .single();
  if (error || !channel) return null;

  // Only this channel's score rows: resolve its episode ids (indexed on
  // channel_id), then DB-filter classifications to those episodes.
  const episodeIds = await fetchChannelEpisodeIds(db, channelId);
  const rows = await fetchScoreRowsFiltered({ kind: "episodes", episodeIds });
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

  // Net-lean trend across all this channel's issues (helper windows to ~37d).
  const trend = rollingLeanTrend(
    rows.filter((r) => r.channel_id === channelId),
    new Date(),
  );

  return {
    channel_id: channel.id,
    channel_name: channel.name,
    channel_lean: channel.political_lean,
    channel_reach: Number(channel.reach),
    netLean,
    issues,
    numEpisodes: new Set(channelRows.map((r) => r.episode_id)).size,
    numClassifications: channelRows.length,
    trend,
  };
}
