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
 * Platform priority for cross-platform dedup. When the same episode (same
 * title + date) is posted to both a show's YouTube and podcast feeds, the
 * higher-priority platform's copy is the one kept; the other is skipped.
 * YouTube wins: it carries the real subscriber-count reach and supports
 * deep-link mention timestamps (a YouTube-only feature). Unranked platforms
 * default to 0 (lowest). See `siblingPlatformsOutranking`.
 */
export const PLATFORM_PRIORITY: Record<string, number> = {
  youtube: 2,
  podcast: 1,
};

/** Sibling platforms that strictly outrank `platform` for dedup purposes. An
 *  episode is skipped only if a sibling on one of these already has it. For the
 *  top platform (youtube) this is empty -> it never defers to a sibling. */
export function siblingPlatformsOutranking(platform: string): string[] {
  const rank = PLATFORM_PRIORITY[platform] ?? 0;
  return Object.entries(PLATFORM_PRIORITY)
    .filter(([, r]) => r > rank)
    .map(([p]) => p);
}

/**
 * Keys of episodes already ingested on a *higher-priority sibling* channel of
 * the same show (same name, a platform that outranks `platform`) within the
 * last 30 days. An episode whose key is in this set is a cross-platform re-post
 * already covered by a preferred platform and should be skipped.
 *
 * Directional (v0.32.3): a podcast episode defers to its YouTube sibling, but a
 * YouTube episode is never skipped because of a podcast sibling (returns an
 * empty set). This makes the dedup tie-break for shared episodes deterministic
 * toward YouTube instead of "whichever copy was ingested first".
 */
export async function loadSiblingEpisodeKeys(
  db: ReturnType<typeof createServiceClient>,
  channelId: string,
  channelName: string,
  platform: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const higherPlatforms = siblingPlatformsOutranking(platform);
  if (higherPlatforms.length === 0) return keys; // top priority -> never defers
  const { data: siblings } = await db
    .from("channels")
    .select("id")
    .eq("name", channelName)
    .neq("id", channelId)
    .in("platform", higherPlatforms);
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
