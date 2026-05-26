/**
 * Cross-platform episode dedup. A show tracked on both YouTube and a podcast
 * feed publishes the same episode to both, which would otherwise be ingested
 * twice and double-count in the Index. These helpers detect the re-post so
 * ingestion can skip it (the higher-reach copy, ingested first, wins).
 *
 * Kept dependency-light (no next/server) so both the cron pipeline and the
 * tsx CLI ingest script can import it. See the 2026-05-26 Rubin Report dedup.
 */
import { createServiceClient } from "./db";

/** Normalize a title for matching: lowercase, strip non-alphanumerics. */
export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "<normTitle>|<YYYY-MM-DD>" key for cross-platform duplicate detection. */
export function dedupKey(title: string, publishedAt: string): string {
  return `${normalizeTitle(title)}|${new Date(publishedAt).toISOString().slice(0, 10)}`;
}

/**
 * Keys of episodes already ingested on *sibling* channels of the same show
 * (same name, other platform) within the last 30 days. An episode whose key is
 * in this set is a cross-platform re-post and should be skipped.
 */
export async function loadSiblingEpisodeKeys(
  db: ReturnType<typeof createServiceClient>,
  channelId: string,
  channelName: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const { data: siblings } = await db
    .from("channels")
    .select("id")
    .eq("name", channelName)
    .neq("id", channelId);
  const siblingIds = (siblings || []).map((c: { id: string }) => c.id);
  if (siblingIds.length === 0) return keys;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const { data: eps } = await db
    .from("episodes")
    .select("title, published_at")
    .in("channel_id", siblingIds)
    .gte("published_at", since.toISOString());
  for (const e of (eps || []) as { title: string; published_at: string }[]) {
    keys.add(dedupKey(e.title, e.published_at));
  }
  return keys;
}
