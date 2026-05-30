/**
 * PodScan.fm API client.
 *
 * Docs: https://podscan.fm/docs/rest-api
 * Base URL: https://podscan.fm/api/v1
 * Auth: Bearer token in Authorization header
 *
 * Confirmed endpoints:
 *  - GET /podcasts/search?query=<terms>  — search podcasts by name
 *  - GET /episodes/search?query=<terms>  — full-text search across episode transcripts
 *  - GET /mentions/search?terms=...      — brand/topic mentions
 *
 * Episode-list and transcript endpoints below are best-guess; will be
 * verified and corrected when ingest runs (not exercised by seed-channels).
 */
import { env } from "./env";

const PODSCAN_API = "https://podscan.fm/api/v1";

/**
 * PodScan podcast shape. We don't yet know which keys PodScan uses for ID and
 * title (different across endpoints), so we declare all common variants as
 * optional and let the caller normalize with fallback logic.
 */
export interface PodscanPodcast {
  // ID field variants — exactly one should be populated
  id?: string;
  podcast_id?: string;
  uuid?: string;
  slug?: string;
  pscid?: string;
  // Title field variants
  title?: string;
  name?: string;
  podcast_name?: string;
  // Other commonly seen fields
  description?: string;
  feed_url?: string;
  itunes_id?: string;
  image_url?: string;
  // Allow access to anything else PodScan returns
  [key: string]: any;
}

/**
 * PodScan episode shape.
 *
 * Confirmed (as of 2026-05-11) PodScan uses `episode_` prefixed field names
 * on this endpoint and `posted_at` for the publish date. Transcripts arrive
 * inline as `episode_transcript`.
 */
export interface PodscanEpisode {
  // PodScan canonical fields (confirmed)
  episode_id?: string;
  episode_guid?: string;
  episode_title?: string;
  episode_url?: string;
  episode_audio_url?: string;
  episode_audio_url_normalized?: string;
  episode_image_url?: string;
  episode_apple_url?: string;
  episode_spotify_url?: string;
  episode_permalink?: string;
  episode_duration?: number;
  episode_word_count?: number;
  episode_transcript?: string;
  episode_transcript_word_level_timestamps?: any;
  episode_description?: string;
  episode_categories?: string[];
  episode_iab_category?: string;
  episode_has_guests?: boolean;
  episode_has_sponsors?: boolean;
  posted_at?: string;
  created_at?: string;
  updated_at?: string;
  podcast?: any;
  metadata?: any;
  topics?: any;
  sponsor_segments?: any[];
  listener_engagement?: any;
  // Legacy/alt variants — kept for defensive parsing
  id?: string;
  uuid?: string;
  title?: string;
  name?: string;
  podcast_id?: string;
  published_at?: string;
  url?: string;
  audio_url?: string;
  [key: string]: any;
}

async function podscanFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${PODSCAN_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.podscanApiKey}`,
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PodScan ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Search PodScan for podcasts matching a query string.
 * Returns the top results; caller should pick the most relevant by title match.
 *
 * Endpoint: /podcasts/search?query=... (mirrors the /episodes/search shape).
 */
export async function searchPodcasts(query: string): Promise<PodscanPodcast[]> {
  const data = await podscanFetch<{
    podcasts?: PodscanPodcast[];
    data?: PodscanPodcast[];
    results?: PodscanPodcast[];
  }>(`/podcasts/search?query=${encodeURIComponent(query)}`);
  // PodScan response keys vary — try the common shapes
  return data.podcasts || data.data || data.results || [];
}

/**
 * Fetch a single podcast by its PodScan id. Used by the daily reach-refresh
 * pass (v0.6.57) — every channel iteration already has the stored
 * platform_id, so we can hit the canonical podcast record and pull
 * whatever reach metric PodScan currently exposes via the same pickReach
 * fallback used at seed time. Returns null on 404 or any error so the
 * refresh degrades gracefully (a missed refresh is fine; a thrown error
 * would kill the whole ingest pass).
 */
export async function getPodcastById(podcastId: string): Promise<PodscanPodcast | null> {
  try {
    const data = await podscanFetch<{
      podcast?: PodscanPodcast;
      data?: PodscanPodcast;
    }>(`/podcasts/${encodeURIComponent(podcastId)}`);
    return data.podcast || data.data || null;
  } catch {
    return null;
  }
}

/**
 * List recent episodes for a podcast.
 * Best-guess endpoint: /podcasts/{id}/episodes (REST convention).
 * Falls back to flexible response parsing — caller normalizes field names.
 */
export async function getPodcastEpisodes(
  podcastId: string,
  limit = 10,
): Promise<PodscanEpisode[]> {
  const data = await podscanFetch<{
    episodes?: PodscanEpisode[];
    data?: PodscanEpisode[];
    results?: PodscanEpisode[];
  }>(`/podcasts/${encodeURIComponent(podcastId)}/episodes?limit=${limit}`);
  return data.episodes || data.data || data.results || [];
}

/**
 * Fetch the transcript for a single episode.
 * Returns null if not yet transcribed or fetch fails.
 */
export async function getEpisodeTranscript(episodeId: string): Promise<string | null> {
  try {
    const data = await podscanFetch<{ transcript?: string; text?: string }>(
      `/episodes/${episodeId}/transcript`,
    );
    return data.transcript || data.text || null;
  } catch {
    return null;
  }
}
