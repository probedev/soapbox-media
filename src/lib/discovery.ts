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

  // Group topics by normalized label.
  const groups = new Map<string, { rep: string; topicIds: string[] }>();
  for (const t of topics) {
    const norm = t.label.trim().toLowerCase();
    if (!norm) continue;
    const g = groups.get(norm) || { rep: t.label.trim(), topicIds: [] };
    g.topicIds.push(t.id);
    groups.set(norm, g);
  }

  // Stable, count-desc order; cap to bound the clustering prompt.
  const ordered = [...groups.values()].sort((a, b) => b.topicIds.length - a.topicIds.length).slice(0, 250);
  const labelInputs: LabelInput[] = ordered.map((g) => ({ label: g.rep, count: g.topicIds.length }));

  const { themes, inputTokens, outputTokens } = await clusterTopics(labelInputs);

  const topicById = new Map(topics.map((t) => [t.id, t]));
  const now = Date.now();
  let created = 0;

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

    const { data: ins, error: insErr } = await db
      .from("discovery_candidates")
      .insert({
        label: theme.canonical_label,
        summary: theme.summary,
        example_quotes,
        topic_count: members.length,
        episode_count: episodes.size,
        channel_count: channels.size,
        weight: Number(weight.toFixed(2)),
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
      .in("id", members.map((m) => m.id));
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
