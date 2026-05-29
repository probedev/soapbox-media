/**
 * Channel-audit helpers. Powers /admin/channels-audit. Designed to be
 * called server-side from the admin page.
 *
 * All aggregations done in JS rather than SQL views — at current data
 * volume (49 channels, ~200 episodes, ~1.3k classifications) the
 * pull-and-group approach is well under 1 second. Move to materialized
 * views when classifications cross ~50k rows.
 */
import { createServiceClient } from "./db";

export interface ChannelAuditRow {
  id: string;
  name: string;
  political_lean: "L" | "M" | "R";
  platform: "youtube" | "podcast";
  reach: number;
  episodes_14d: number;
  last_published_at: string | null;
  classifications_14d: number;
  distinct_issues_14d: number;
}

export interface IssueGapRow {
  slug: string;
  name: string;
  l_mentions: number;
  m_mentions: number;
  r_mentions: number;
  total: number;
  /** r - l ; positive = R-heavy ; negative = L-heavy */
  lean_gap: number;
}

export interface CandidateVoice {
  name: string;
  tracked: boolean;
  mentions: number;
}

/**
 * Channels we already track (for the "mentioned but not tracked" report).
 * Names should be reasonably unique tokens; ambiguous first names get
 * excluded to avoid false positives.
 */
const VOICE_CANDIDATES: { name: string; tracked: boolean }[] = [
  // Tracked (sanity checks)
  { name: "Joe Rogan", tracked: true },
  { name: "Ben Shapiro", tracked: true },
  { name: "Tim Pool", tracked: true },
  { name: "Tucker Carlson", tracked: true },
  { name: "Charlie Kirk", tracked: true },
  { name: "Megyn Kelly", tracked: true },
  { name: "Matt Walsh", tracked: true },
  { name: "Crowder", tracked: true },
  { name: "Candace", tracked: true },
  { name: "Hannity", tracked: true },
  { name: "Levin", tracked: true },
  { name: "Bannon", tracked: true },
  { name: "Bongino", tracked: true },
  { name: "Lex Fridman", tracked: true },
  { name: "Bari Weiss", tracked: true },
  { name: "Krystal Ball", tracked: true },
  { name: "Saagar Enjeti", tracked: true },
  { name: "MeidasTouch", tracked: true },
  { name: "Cenk", tracked: true }, // The Young Turks
  { name: "Pakman", tracked: true },
  { name: "Sam Seder", tracked: true },
  { name: "Mehdi Hasan", tracked: true },
  { name: "Mockler", tracked: true },
  { name: "Don Lemon", tracked: true },
  { name: "Destiny", tracked: true },
  { name: "Kyle Kulinski", tracked: true },
  { name: "Glenn Beck", tracked: true },
  { name: "Ezra Klein", tracked: true },
  { name: "Patrick Bet-David", tracked: true },
  { name: "PBD", tracked: true },
  // Not tracked — candidates to evaluate
  { name: "Theo Von", tracked: false },
  { name: "Andrew Schulz", tracked: false },
  { name: "Russell Brand", tracked: false },
  { name: "Jordan Peterson", tracked: false },
  { name: "Hasan Piker", tracked: false },
  { name: "Sam Harris", tracked: false },
  { name: "Joe Pags", tracked: false },
  { name: "Dave Smith", tracked: false },
  { name: "Glenn Greenwald", tracked: false },
  { name: "Coleman Hughes", tracked: false },
  { name: "Andrew Tate", tracked: false },
  { name: "Marc Andreessen", tracked: false },
  { name: "Dan Crenshaw", tracked: false },
  { name: "Vivek Ramaswamy", tracked: false },
  { name: "RFK", tracked: false }, // Robert F Kennedy Jr
  { name: "Yang", tracked: false }, // Andrew Yang
  { name: "Konstantin Kisin", tracked: false }, // Triggernometry, host
  { name: "Konstantin", tracked: false },
  { name: "Triggered", tracked: false },
  { name: "Officer Tatum", tracked: false },
  { name: "Bridget Phetasy", tracked: false },
  { name: "Tomi Lahren", tracked: false },
  { name: "Steven Pinker", tracked: false },
  { name: "Joe Pyrah", tracked: false },
  { name: "Stew Peters", tracked: false },
  { name: "Mark Dice", tracked: false },
];

interface ChannelRow {
  id: string;
  name: string;
  political_lean: "L" | "M" | "R";
  platform: "youtube" | "podcast";
  reach: number;
}

interface EpisodeRow {
  id: string;
  channel_id: string;
  published_at: string;
}

interface ClassificationRow {
  id: string;
  episode_id: string;
  issue_slug: string;
  supporting_quote: string;
}

/**
 * Generic paginated fetch with the canonical Supabase pattern: stable PK
 * ordering + empty-page-only termination. All callers use tables with an
 * `id` PK; the order is hardcoded so the helper's contract is unambiguous
 * ("I paginate by id, ascending") and callers can't accidentally pass a
 * non-unique sort key. See [[pagination-stable-order]] / v0.6.51 for why
 * both halves of this pattern matter — a short-page early-out (the bug
 * removed below) silently drops the tail on deep-join queries, and missing
 * ORDER BY lets pages overlap once the table grows past the Max Rows cap.
 */
async function paginatedSelect<T>(
  table: string,
  selectExpr: string,
  filters?: (q: any) => any,
): Promise<T[]> {
  const db = createServiceClient();
  const all: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = db.from(table).select(selectExpr);
    if (filters) query = filters(query);
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as T[]));
    // Empty-page-only termination — a short page on Vercel's edge→Supabase
    // route is normal on deep payloads and does NOT mean we're done.
  }
  return all;
}

export async function getChannelAudit(): Promise<ChannelAuditRow[]> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  const cutoffIso = cutoff.toISOString();

  const channels = await paginatedSelect<ChannelRow>(
    "channels",
    "id, name, political_lean, platform, reach",
    (q) => q.eq("active", true),
  );

  // All episodes ever (we need last_published_at across all time)
  const allEpisodes = await paginatedSelect<EpisodeRow>(
    "episodes",
    "id, channel_id, published_at",
  );

  // All classifications (needed to count per-channel mentions)
  const allClassifications = await paginatedSelect<ClassificationRow>(
    "classifications",
    "id, episode_id, issue_slug, supporting_quote",
  );

  // Index episodes by channel
  const episodesByChannel = new Map<string, EpisodeRow[]>();
  for (const e of allEpisodes) {
    const arr = episodesByChannel.get(e.channel_id) || [];
    arr.push(e);
    episodesByChannel.set(e.channel_id, arr);
  }

  // Index classifications by episode_id for fast channel lookup
  const classificationsByEpisode = new Map<string, ClassificationRow[]>();
  for (const c of allClassifications) {
    const arr = classificationsByEpisode.get(c.episode_id) || [];
    arr.push(c);
    classificationsByEpisode.set(c.episode_id, arr);
  }

  return channels
    .map((c) => {
      const eps = episodesByChannel.get(c.id) || [];
      const recentEps = eps.filter((e) => e.published_at >= cutoffIso);
      const lastPublishedAt = eps.length
        ? eps.reduce((a, b) => (a.published_at > b.published_at ? a : b)).published_at
        : null;

      const recentClassifications = recentEps.flatMap(
        (e) => classificationsByEpisode.get(e.id) || [],
      );
      const distinctIssues = new Set(recentClassifications.map((c) => c.issue_slug)).size;

      return {
        id: c.id,
        name: c.name,
        political_lean: c.political_lean,
        platform: c.platform,
        reach: Number(c.reach) || 0,
        episodes_14d: recentEps.length,
        last_published_at: lastPublishedAt,
        classifications_14d: recentClassifications.length,
        distinct_issues_14d: distinctIssues,
      };
    })
    .sort((a, b) => b.classifications_14d - a.classifications_14d || b.reach - a.reach);
}

export async function getIssueGaps(): Promise<IssueGapRow[]> {
  const db = createServiceClient();

  const channels = await paginatedSelect<{ id: string; political_lean: "L" | "M" | "R" }>(
    "channels",
    "id, political_lean",
  );
  const leanById = new Map(channels.map((c) => [c.id, c.political_lean]));

  const episodes = await paginatedSelect<{ id: string; channel_id: string }>(
    "episodes",
    "id, channel_id",
  );
  const channelByEpisode = new Map(episodes.map((e) => [e.id, e.channel_id]));

  const classifications = await paginatedSelect<{ episode_id: string; issue_slug: string }>(
    "classifications",
    "episode_id, issue_slug",
  );

  const { data: issues } = await db
    .from("issues")
    .select("slug, name")
    .eq("active", true);
  const issuesRows = (issues || []) as { slug: string; name: string }[];

  const counts: Record<string, { L: number; M: number; R: number }> = {};
  for (const i of issuesRows) counts[i.slug] = { L: 0, M: 0, R: 0 };

  for (const c of classifications) {
    const channelId = channelByEpisode.get(c.episode_id);
    if (!channelId) continue;
    const lean = leanById.get(channelId);
    if (!lean || !counts[c.issue_slug]) continue;
    counts[c.issue_slug][lean] += 1;
  }

  return issuesRows
    .map((i) => {
      const c = counts[i.slug];
      const total = c.L + c.M + c.R;
      return {
        slug: i.slug,
        name: i.name,
        l_mentions: c.L,
        m_mentions: c.M,
        r_mentions: c.R,
        total,
        lean_gap: c.R - c.L,
      };
    })
    .sort((a, b) => Math.abs(b.lean_gap) - Math.abs(a.lean_gap));
}

export async function getCandidateVoiceMentions(): Promise<CandidateVoice[]> {
  const classifications = await paginatedSelect<{ supporting_quote: string }>(
    "classifications",
    "supporting_quote",
  );
  const allText = classifications
    .map((c) => c.supporting_quote || "")
    .join(" ")
    .toLowerCase();

  return VOICE_CANDIDATES.map((v) => {
    // Case-insensitive substring count
    const needle = v.name.toLowerCase();
    let count = 0;
    let i = 0;
    while (i < allText.length) {
      const next = allText.indexOf(needle, i);
      if (next === -1) break;
      count++;
      i = next + needle.length;
    }
    return { name: v.name, tracked: v.tracked, mentions: count };
  }).sort((a, b) => b.mentions - a.mentions);
}
