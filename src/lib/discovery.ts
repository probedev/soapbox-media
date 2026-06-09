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
      const recent = now - new Date(m.published_at).getTime() < 7 * 86400_000;
      weight += reachFactor(m.reach) * (recent ? 1.5 : 1);
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
