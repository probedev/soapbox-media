/**
 * Emerging-issue discovery orchestration. Reads off-taxonomy topics harvested
 * during classify (discovery_topics), clusters them into candidate themes
 * (Haiku), scores each by reach × recency × frequency, and rebuilds the pending
 * candidate set for human review at /admin/discovery. Promotion into the
 * taxonomy is always human-gated - this code never edits the issues table on
 * its own (only promoteCandidate, invoked by an admin action, does).
 */
import { createServiceClient } from "@/lib/db";
import { clusterTopics, type LabelInput } from "@/modules/discover";

interface TopicRow {
  id: string;
  label: string;
  quote: string | null;
  episode_id: string;
  channel_name: string;
  reach: number;
  published_at: string;
}

export interface DiscoveryCandidate {
  id: string;
  label: string;
  summary: string | null;
  example_quotes: { quote: string; channel: string }[];
  topic_count: number;
  episode_count: number;
  channel_count: number;
  weight: number;
  status: "pending" | "promoted" | "merged" | "ignored";
  merged_into_slug: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function reachFactor(reach: number): number {
  return Math.log10(Math.max(reach, 10));
}

// Recency model. Each member topic's reach contribution decays with the age of
// the episode it aired in (published_at), halving every RECENCY_HALF_LIFE_DAYS.
// This replaced a binary "x1.5 if <7d else x1" boost that barely moved the board:
// classify harvests off-taxonomy topics long AFTER an episode airs (backlog), so
// the boost fired on only ~17% of members while episodes ran to ~180 days old.
// The board therefore ranked by accumulated stale volume and looked frozen.
// Continuous decay buries old backlog and lets genuine bursts surface. The
// half-life was tuned on the live pending set: at 7 days, 80%-recent bursts climb
// into the top tier (e.g. a fresh trial story #10 -> #4) without over-twitching,
// and it matches the weekly news cycle / the prior 7-day boundary.
const RECENCY_HALF_LIFE_DAYS = 7;

/**
 * Reach contribution of one member topic, decayed by episode age. Shared by the
 * build-time weight (buildDiscoveryCandidates) and the board-time weight
 * (computeBoardRanks) so the two rankings can't drift apart.
 */
function topicWeight(reach: number, publishedAt: string, now: number): number {
  const ageDays = Math.max((now - new Date(publishedAt).getTime()) / 86_400_000, 0);
  return reachFactor(reach) * Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
}

// Stopwords stripped when building the token-set grouping key. Kept tiny on
// purpose - just the connective words that vary between phrasings of one theme.
const THEME_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with",
  "at", "by", "from", "as", "s",
]);

/**
 * Normalized token-set key for grouping near-duplicate off-taxonomy labels.
 * Lowercases, strips punctuation, drops stopwords, de-dupes and sorts tokens,
 * so word-order and punctuation variants of the same theme map to one key
 * ("spencer pratt la mayoral race" == "la mayoral race spencer pratt"). This is
 * a conservative pre-merge; the LLM still does the semantic clustering.
 */
function themeKey(label: string): string {
  const toks = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !THEME_STOPWORDS.has(w));
  return [...new Set(toks)].sort().join(" ");
}

// Review-queue shaping. We cluster the full top-250 label set for good merge
// context, but an emerging *issue* should span at least a few independent
// channels (not one show's hobby horse), and the queue has to stay reviewable.
// So we only persist multi-channel themes, ranked by weight, capped to keep the
// queue at a human-reviewable size. Topics in dropped themes stay unclustered
// and get reconsidered on the next run (they're not buried).
const MIN_CANDIDATE_CHANNELS = 3;
const MAX_PENDING_CANDIDATES = 40;

/** Load recent topics not yet attached to a (decided) candidate. */
async function loadUnclusteredTopics(
  db: ReturnType<typeof createServiceClient>,
  windowDays: number,
): Promise<TopicRow[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);
  const out: TopicRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("discovery_topics")
      .select(
        `id, label, quote, episode_id,
         episode:episodes!discovery_topics_episode_id_fkey (
           published_at,
           channel:channels!episodes_channel_id_fkey ( name, reach )
         )`,
      )
      .is("candidate_id", null)
      .gte("created_at", since.toISOString())
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`loadUnclusteredTopics: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const ch = r.episode?.channel;
      if (!ch) continue;
      out.push({
        id: r.id,
        label: r.label,
        quote: r.quote,
        episode_id: r.episode_id,
        channel_name: ch.name,
        reach: Number(ch.reach) || 0,
        published_at: r.episode?.published_at || new Date().toISOString(),
      });
    }
    if (data.length < pageSize) break;
  }
  return out;
}

export interface BuildResult {
  topicsConsidered: number;
  candidatesCreated: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Rebuild the pending discovery candidates from recent unclustered topics.
 * Decided candidates (promoted/merged/ignored) and their linked topics are
 * left untouched, so dismissed themes don't resurface.
 */
export async function buildDiscoveryCandidates(windowDays = 21): Promise<BuildResult> {
  const db = createServiceClient();

  // Clear prior pending candidates first; on-delete-set-null frees their topics
  // back into the unclustered pool so we rebuild from the full recent set.
  await db.from("discovery_candidates").delete().eq("status", "pending");

  const topics = await loadUnclusteredTopics(db, windowDays);
  if (topics.length === 0) {
    return { topicsConsidered: 0, candidatesCreated: 0, inputTokens: 0, outputTokens: 0 };
  }

  // Group topics by a normalized token-set key so trivial phrasing variants of
  // the same theme collapse (word order, punctuation, stopwords). Exact-string
  // grouping fragmented the signal: "la mayoral race spencer pratt" and
  // "spencer pratt la mayoral race" counted as two distinct candidates, so a
  // genuinely hot theme split across phrasings could miss the top-250 cut below.
  const groups = new Map<string, { reps: Map<string, number>; topicIds: string[] }>();
  for (const t of topics) {
    const raw = t.label.trim();
    if (!raw) continue;
    const key = themeKey(raw);
    if (!key) continue;
    const g = groups.get(key) || { reps: new Map<string, number>(), topicIds: [] };
    g.topicIds.push(t.id);
    g.reps.set(raw, (g.reps.get(raw) || 0) + 1);
    groups.set(key, g);
  }

  // Stable, count-desc order; cap to bound the clustering prompt. The label
  // shown to the model is the most common surface form within each group.
  const ordered = [...groups.values()]
    .map((g) => ({
      rep: [...g.reps.entries()].sort((a, b) => b[1] - a[1])[0][0],
      topicIds: g.topicIds,
    }))
    .sort((a, b) => b.topicIds.length - a.topicIds.length)
    .slice(0, 250);
  const labelInputs: LabelInput[] = ordered.map((g) => ({ label: g.rep, count: g.topicIds.length }));

  const { themes, inputTokens, outputTokens } = await clusterTopics(labelInputs);

  const topicById = new Map(topics.map((t) => [t.id, t]));
  const now = Date.now();

  // Build candidate rows from the clustered themes WITHOUT writing yet, so we
  // can rank by weight and keep only the most significant for the review queue.
  interface Prepared {
    label: string;
    summary: string;
    example_quotes: { quote: string; channel: string }[];
    topic_count: number;
    episode_count: number;
    channel_count: number;
    weight: number;
    memberIds: string[];
  }
  const prepared: Prepared[] = [];
  for (const theme of themes) {
    // Member topics = union of topic ids for each member label group.
    const memberTopicIds = new Set<string>();
    for (const idx of theme.member_indices) {
      for (const id of ordered[idx]?.topicIds || []) memberTopicIds.add(id);
    }
    const members = [...memberTopicIds].map((id) => topicById.get(id)!).filter(Boolean);
    if (members.length === 0) continue;

    const episodes = new Set(members.map((m) => m.episode_id));
    const channels = new Set(members.map((m) => m.channel_name));
    let weight = 0;
    for (const m of members) {
      weight += topicWeight(m.reach, m.published_at, now);
    }
    const example_quotes = members
      .filter((m) => m.quote && m.quote.trim().length > 0)
      .slice(0, 3)
      .map((m) => ({ quote: m.quote as string, channel: m.channel_name }));

    prepared.push({
      label: theme.canonical_label,
      summary: theme.summary,
      example_quotes,
      topic_count: members.length,
      episode_count: episodes.size,
      channel_count: channels.size,
      weight: Number(weight.toFixed(2)),
      memberIds: members.map((m) => m.id),
    });
  }

  // Keep only multi-channel themes, then the highest-weighted ones, so the queue
  // surfaces genuinely shared emerging issues rather than every micro-cluster.
  const selected = prepared
    .filter((c) => c.channel_count >= MIN_CANDIDATE_CHANNELS)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_PENDING_CANDIDATES);

  let created = 0;
  for (const c of selected) {
    const { data: ins, error: insErr } = await db
      .from("discovery_candidates")
      .insert({
        label: c.label,
        summary: c.summary,
        example_quotes: c.example_quotes,
        topic_count: c.topic_count,
        episode_count: c.episode_count,
        channel_count: c.channel_count,
        weight: c.weight,
        status: "pending",
      })
      .select("id")
      .single();
    if (insErr || !ins) continue;
    created++;

    // Link member topics to the candidate so they're not re-clustered.
    await db
      .from("discovery_topics")
      .update({ candidate_id: ins.id })
      .in("id", c.memberIds);
  }

  // Snapshot the freshly-built board so the public page can show rank movement
  // vs the previous rebuild. Best-effort: a snapshot failure must not fail the
  // rebuild (the board still renders, just without movement arrows).
  try {
    await snapshotEmergingRanks();
  } catch (e) {
    console.error("snapshotEmergingRanks (post-build):", (e as Error)?.message || e);
  }

  return {
    topicsConsidered: topics.length,
    candidatesCreated: created,
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
  };
}

/** Candidates for the admin review queue, default pending, weight-desc. */
export async function getDiscoveryCandidates(
  status: DiscoveryCandidate["status"] = "pending",
): Promise<DiscoveryCandidate[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("discovery_candidates")
    .select("*")
    .eq("status", status)
    .order("weight", { ascending: false });
  if (error) {
    console.error("getDiscoveryCandidates:", error.message);
    return [];
  }
  return (data || []) as DiscoveryCandidate[];
}

/**
 * Rank movement vs the previous daily refresh.
 * - up/down: changed rank (delta = absolute number of places, always positive)
 * - same: present last refresh at the same rank
 * - new: not present in the previous snapshot (or its theme was reworded)
 * - none: no prior snapshot to compare against yet (first day, or empty history)
 */
export interface RankMovement {
  status: "up" | "down" | "same" | "new" | "none";
  delta: number;
  prevRank: number | null;
}

/** Lean public shape for the /emerging board (pending candidates only). */
export interface EmergingIssue {
  id: string;
  /** 1-based rank by weight (the canonical trending order). */
  rank: number;
  label: string;
  summary: string | null;
  topicCount: number;
  episodeCount: number;
  channelCount: number;
  weight: number;
  movement: RankMovement;
}

export interface EmergingBoard {
  /** All cohorts combined. */
  all: EmergingIssue[];
  independent: EmergingIssue[];
  legacy: EmergingIssue[];
  /** When the current pending set was last rebuilt (max created_at), or null. */
  lastUpdated: string | null;
}

/**
 * Public emerging-issue board with per-cohort cuts. Pending discovery candidates,
 * ranked by weight. Auto-detected, machine-clustered issues NOT yet in the
 * taxonomy and NOT hand-curated; showing the raw signal publicly is fine, but
 * promotion into a real persistent issue stays human-gated (/admin/discovery).
 *
 * The cohort cuts (independent / legacy) are RECOMPUTED from the candidates'
 * member topics, not the stored all-cohort stats - otherwise a tab would show a
 * candidate's combined weight/mentions/channels, which is wrong for the filtered
 * view, and independent-only issues would wrongly appear under legacy. Cohorts
 * partition cleanly (every channel is exactly one of independent|legacy), so
 * `all` = independent + legacy. We compute all three in one pass over
 * discovery_topics joined to episode + channel, mirroring the build-time weight
 * (reachFactor x half-life recency decay). Refreshed daily by the discover cron.
 *
 * This is the raw rank computation (no movement). getEmergingBoard() layers the
 * up/down movement on top; snapshotEmergingRanks() persists these ranks daily.
 */
async function computeBoardRanks(): Promise<EmergingBoard> {
  const db = createServiceClient();

  const { data: cands, error: cErr } = await db
    .from("discovery_candidates")
    .select("id, label, summary, created_at")
    .eq("status", "pending");
  if (cErr) {
    console.error("getEmergingBoard candidates:", cErr.message);
    return { all: [], independent: [], legacy: [], lastUpdated: null };
  }
  const meta = new Map<string, { label: string; summary: string | null }>();
  let lastUpdated: string | null = null;
  for (const c of (cands as any[]) || []) {
    meta.set(c.id, { label: c.label, summary: c.summary });
    if (c.created_at && (!lastUpdated || c.created_at > lastUpdated)) lastUpdated = c.created_at;
  }
  const pendingIds = [...meta.keys()];
  if (pendingIds.length === 0) {
    return { all: [], independent: [], legacy: [], lastUpdated };
  }

  // Member topics of all pending candidates, with channel cohort + reach and the
  // episode published_at for the recency boost. Paginate (stable id order).
  interface TopicRow {
    candidate_id: string;
    episode_id: string;
    channel: string;
    cohort: string;
    reach: number;
    published_at: string;
  }
  const topics: TopicRow[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 30; page++) {
    const { data, error } = await db
      .from("discovery_topics")
      .select(
        `id, candidate_id, episode_id,
         episode:episodes!discovery_topics_episode_id_fkey!inner (
           published_at,
           channel:channels!episodes_channel_id_fkey!inner ( name, cohort, reach )
         )`,
      )
      .in("candidate_id", pendingIds)
      .order("id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`getEmergingBoard topics: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const e = r.episode;
      const ch = e?.channel;
      if (!e || !ch) continue;
      topics.push({
        candidate_id: r.candidate_id,
        episode_id: r.episode_id,
        channel: ch.name,
        cohort: ch.cohort,
        reach: Number(ch.reach) || 0,
        published_at: e.published_at,
      });
    }
    if (data.length < pageSize) break;
  }

  const now = Date.now();
  interface Acc {
    topicCount: number;
    episodes: Set<string>;
    channels: Set<string>;
    weight: number;
  }
  const newAcc = (): Acc => ({ topicCount: 0, episodes: new Set(), channels: new Set(), weight: 0 });
  const accs = new Map<string, { all: Acc; independent: Acc; legacy: Acc }>();
  for (const id of pendingIds) accs.set(id, { all: newAcc(), independent: newAcc(), legacy: newAcc() });

  for (const t of topics) {
    const a = accs.get(t.candidate_id);
    if (!a) continue;
    const w = topicWeight(t.reach, t.published_at, now);
    const add = (acc: Acc) => {
      acc.topicCount++;
      acc.episodes.add(t.episode_id);
      acc.channels.add(t.channel);
      acc.weight += w;
    };
    add(a.all);
    if (t.cohort === "independent") add(a.independent);
    else if (t.cohort === "legacy") add(a.legacy);
  }

  const build = (scope: "all" | "independent" | "legacy"): EmergingIssue[] => {
    const rows: EmergingIssue[] = [];
    for (const id of pendingIds) {
      const acc = accs.get(id)![scope];
      if (acc.topicCount === 0) continue;
      const m = meta.get(id)!;
      rows.push({
        id,
        rank: 0,
        label: m.label,
        summary: m.summary,
        topicCount: acc.topicCount,
        episodeCount: acc.episodes.size,
        channelCount: acc.channels.size,
        weight: Number(acc.weight.toFixed(2)),
        movement: { status: "none", delta: 0, prevRank: null },
      });
    }
    rows.sort((a, b) => b.weight - a.weight);
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    return rows;
  };

  return {
    all: build("all"),
    independent: build("independent"),
    legacy: build("legacy"),
    lastUpdated,
  };
}

/**
 * Public emerging board = the live rank computation with up/down movement
 * attached. Movement is the live board diffed against the PREVIOUS daily
 * snapshot (not the latest, which ~equals the live board, so every delta would
 * read zero). Keyed by normalized theme (themeKey) so a continuing issue keeps
 * its history across the daily candidate rebuild (UUIDs are regenerated) and
 * minor LLM relabeling; a theme with no prior match reads as "new".
 */
export async function getEmergingBoard(): Promise<EmergingBoard> {
  const board = await computeBoardRanks();
  try {
    await attachMovement(board);
  } catch (e) {
    // Movement is a non-essential overlay - never let it break the board.
    console.error("attachMovement:", (e as Error)?.message || e);
  }
  return board;
}

/** Per-cohort theme-keyed rank map from a single day's snapshot. */
type PrevRankMap = Map<string, number>; // `${cohort}|${theme_key}` -> rank

/** Stable movement key for a row (matches the snapshot's theme_key). */
function movementKey(cohort: string, label: string): string {
  return `${cohort}|${themeKey(label) || label.trim().toLowerCase()}`;
}

/** Attach rank movement to an already-ranked board, in place. */
async function attachMovement(board: EmergingBoard): Promise<void> {
  const db = createServiceClient();

  // Pick the snapshot to diff the live board against. The live board ~equals
  // TODAY's snapshot (same candidate set, same recency model), so diffing against
  // it would read every delta as zero. Rule:
  //   - if the latest snapshot predates today (UTC), it IS the prior board (the
  //     daily rebuild hasn't run yet, or we just deployed) -> diff against it;
  //   - otherwise the latest snapshot is today's, so diff against the one before.
  // This is robust to timezone (dates are UTC), page-load time, a late cron, and
  // same-day admin rebuilds (which upsert into today's date, not a new one).
  const { data: dateRows, error: dErr } = await db
    .from("emerging_rank_history")
    .select("captured_on")
    .order("captured_on", { ascending: false })
    .limit(500);
  if (dErr) {
    console.error("attachMovement dates:", dErr.message);
    return;
  }
  const distinct: string[] = [];
  for (const r of (dateRows as { captured_on: string }[]) || []) {
    if (distinct[distinct.length - 1] !== r.captured_on) distinct.push(r.captured_on);
    if (distinct.length >= 2) break;
  }
  const today = new Date().toISOString().slice(0, 10); // UTC date
  const prevDate = distinct[0] && distinct[0] < today ? distinct[0] : distinct[1];
  if (!prevDate) return; // no prior refresh to compare against yet

  const { data: prevRows, error: pErr } = await db
    .from("emerging_rank_history")
    .select("cohort, theme_key, rank")
    .eq("captured_on", prevDate);
  if (pErr) {
    console.error("attachMovement prev:", pErr.message);
    return;
  }
  const prev: PrevRankMap = new Map();
  for (const r of (prevRows as { cohort: string; theme_key: string; rank: number }[]) || []) {
    prev.set(`${r.cohort}|${r.theme_key}`, r.rank);
  }

  const apply = (cohort: "all" | "independent" | "legacy", rows: EmergingIssue[]) => {
    for (const row of rows) {
      const pr = prev.get(movementKey(cohort, row.label));
      if (pr === undefined) {
        row.movement = { status: "new", delta: 0, prevRank: null };
      } else if (pr === row.rank) {
        row.movement = { status: "same", delta: 0, prevRank: pr };
      } else {
        // Smaller rank number = higher on the board, so pr > rank means it climbed.
        const delta = pr - row.rank;
        row.movement = {
          status: delta > 0 ? "up" : "down",
          delta: Math.abs(delta),
          prevRank: pr,
        };
      }
    }
  };
  apply("all", board.all);
  apply("independent", board.independent);
  apply("legacy", board.legacy);
}

/**
 * Persist today's board ranks to emerging_rank_history so the next refresh can
 * show movement. Idempotent: upserts one row per (captured_on, cohort,
 * theme_key), so a same-day rebuild updates rather than duplicates. Called at the
 * end of each candidate rebuild (cron + admin). Best-effort by its callers.
 */
export async function snapshotEmergingRanks(): Promise<void> {
  const db = createServiceClient();
  const board = await computeBoardRanks();
  const capturedOn = new Date().toISOString().slice(0, 10); // UTC date

  interface SnapRow {
    captured_on: string;
    cohort: string;
    theme_key: string;
    label: string;
    rank: number;
    weight: number;
  }
  const rows: SnapRow[] = [];
  const seen = new Set<string>(); // guard duplicate theme_key within a cohort/day
  const cohorts: [string, EmergingIssue[]][] = [
    ["all", board.all],
    ["independent", board.independent],
    ["legacy", board.legacy],
  ];
  for (const [cohort, list] of cohorts) {
    for (const r of list) {
      const tk = themeKey(r.label) || r.label.trim().toLowerCase();
      const dedup = `${cohort}|${tk}`;
      if (seen.has(dedup)) continue; // keep the better-ranked row (list is rank-asc)
      seen.add(dedup);
      rows.push({
        captured_on: capturedOn,
        cohort,
        theme_key: tk,
        label: r.label,
        rank: r.rank,
        weight: r.weight,
      });
    }
  }
  if (rows.length === 0) return;

  const { error } = await db
    .from("emerging_rank_history")
    .upsert(rows, { onConflict: "captured_on,cohort,theme_key" });
  if (error) console.error("snapshotEmergingRanks upsert:", error.message);
}

/** Active taxonomy issues - for the "merge into" dropdown. */
export async function getActiveIssueOptions(): Promise<{ slug: string; name: string }[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("issues")
    .select("slug, name")
    .eq("active", true)
    .order("name");
  return (data || []) as { slug: string; name: string }[];
}

export interface PromoteInput {
  candidateId: string;
  slug: string;
  name: string;
  definition: string;
  leftPosition: string;
  rightPosition: string;
  /** Parent Topic the new child issue sits under (required). */
  topicSlug: string;
}

/** Human-gated: create a new child issue (under a parent Topic) from a candidate. */
export async function promoteCandidate(input: PromoteInput): Promise<{ error?: string }> {
  if (!input.topicSlug) return { error: "Choose a parent topic." };
  const db = createServiceClient();
  const { error: issueErr } = await db.from("issues").insert({
    slug: input.slug,
    name: input.name,
    definition: input.definition,
    left_position: input.leftPosition,
    right_position: input.rightPosition,
    topic_slug: input.topicSlug,
    active: true,
  });
  if (issueErr) return { error: issueErr.message };
  await db
    .from("discovery_candidates")
    .update({
      status: "promoted",
      merged_into_slug: input.slug,
      assigned_topic_slug: input.topicSlug,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.candidateId);
  return {};
}

/** Parent Topics - for the promote form's "parent topic" dropdown. */
export async function getTopicOptions(): Promise<{ slug: string; name: string }[]> {
  const db = createServiceClient();
  const { data } = await db.from("topics").select("slug, name").order("sort_order");
  return (data || []) as { slug: string; name: string }[];
}

export async function mergeCandidate(candidateId: string, slug: string): Promise<void> {
  const db = createServiceClient();
  await db
    .from("discovery_candidates")
    .update({ status: "merged", merged_into_slug: slug, reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
}

export async function ignoreCandidate(candidateId: string): Promise<void> {
  const db = createServiceClient();
  await db
    .from("discovery_candidates")
    .update({ status: "ignored", reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
}
