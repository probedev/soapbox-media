/**
 * YouTube Data API v3 helpers + Supadata transcript fetcher.
 *
 * We use raw fetch() against YouTube's REST API rather than the heavier
 * `googleapis` SDK - we only need a small subset of endpoints and avoiding
 * the SDK keeps deps lean.
 *
 * Transcripts are fetched via Supadata's managed API (v0.6.14) rather
 * than the previous `youtube-transcript` library, which had two
 * compounding failure modes:
 *   1. Library bug - returned "Transcript is disabled" for videos that
 *      actually had captions on YouTube. Documented issue, mid-2024+.
 *   2. Cloud IP blocking - even when the library worked, YouTube
 *      throttled requests from Vercel/GH Actions egress pools.
 * Supadata is just an HTTPS call from anywhere - no scraping, no IP
 * issues, no library maintenance. ~$17/mo at our volume on the Pro plan.
 *
 * Quota notes: each `channels.list` call costs 1 unit, `playlistItems.list`
 * costs 1 unit. Default daily quota is 10,000 units. Our 23 YT channels
 * polled hourly = ~552 units/day. Well under quota.
 */
import { env } from "./env";
import type { TranscriptSegment } from "./transcript-timing";

const YT_API = "https://www.googleapis.com/youtube/v3";

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  uploadsPlaylistId: string;
}

export interface YouTubeVideoSummary {
  videoId: string;
  publishedAt: string;
  title: string;
  url: string;
  /** Duration in seconds. Available when fetched via getRecentUploads. */
  durationSec?: number;
  /** Cumulative view count at fetch time. Populated by getRecentUploads
   *  (it rides along on the same videos.list call), used for the Phase-0
   *  episode_metrics snapshot. null when YouTube hides the count. */
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
}

/** Per-video engagement stats from videos.list?part=statistics. Any field can be
 *  null: YouTube hides like counts on some videos and disables comments on others. */
export interface VideoStats {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

/** Parse a YouTube statistics string ("12345" | undefined) to a number | null. */
function parseStat(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an ISO 8601 duration like "PT1H23M45S" to seconds.
 * YouTube returns durations in this format on the videos.list endpoint.
 */
function parseIsoDuration(iso: string): number {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (
    parseInt(h || "0", 10) * 3600 +
    parseInt(m || "0", 10) * 60 +
    parseInt(s || "0", 10)
  );
}

async function ytFetch<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${YT_API}${path}${sep}key=${env.youtubeApiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Resolve a channel by handle (e.g. "@MeidasTouch") to full channel info.
 * Returns null if not found.
 */
export async function resolveChannelByHandle(
  handle: string,
): Promise<YouTubeChannelInfo | null> {
  const cleanHandle = handle.startsWith("@") ? handle.slice(1) : handle;
  const data = await ytFetch<{
    items?: Array<{
      id: string;
      snippet: { title: string; description: string };
      statistics: { subscriberCount: string; videoCount: string; viewCount: string };
      contentDetails: { relatedPlaylists: { uploads: string } };
    }>;
  }>(`/channels?forHandle=${encodeURIComponent(cleanHandle)}&part=snippet,statistics,contentDetails`);

  const channel = data.items?.[0];
  if (!channel) return null;

  return {
    id: channel.id,
    title: channel.snippet.title,
    description: channel.snippet.description,
    subscriberCount: parseInt(channel.statistics.subscriberCount || "0", 10),
    videoCount: parseInt(channel.statistics.videoCount || "0", 10),
    viewCount: parseInt(channel.statistics.viewCount || "0", 10),
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

/**
 * List the most recent uploads from a channel's "uploads" playlist,
 * with duration in seconds. Costs 2 quota units per call (playlistItems.list
 * + videos.list).
 */
export async function getRecentUploads(
  uploadsPlaylistId: string,
  maxResults = 10,
): Promise<YouTubeVideoSummary[]> {
  // Step 1: get video IDs from the uploads playlist
  const playlistData = await ytFetch<{
    items?: Array<{
      contentDetails: { videoId: string; videoPublishedAt?: string };
      snippet: { title: string; publishedAt: string };
    }>;
  }>(
    `/playlistItems?playlistId=${uploadsPlaylistId}&part=snippet,contentDetails&maxResults=${maxResults}`,
  );

  const videos: YouTubeVideoSummary[] = (playlistData.items || []).map((item) => ({
    videoId: item.contentDetails.videoId,
    publishedAt: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
  }));

  if (videos.length === 0) return videos;

  // Step 2: batch-fetch durations AND statistics via videos.list. Adding
  // `statistics` to the part costs nothing extra (same call we already make for
  // duration) and gives us per-video view counts for the episode_metrics
  // snapshot (v0.32.0). One call covers up to 50 ids; INGEST_PER_CHANNEL*2 is
  // well under that.
  const ids = videos.map((v) => v.videoId).join(",");
  const detailsData = await ytFetch<{
    items?: Array<{
      id: string;
      contentDetails: { duration: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
  }>(`/videos?id=${ids}&part=contentDetails,statistics`);

  const detailMap = new Map<string, { durationSec: number; stats: VideoStats }>();
  for (const item of detailsData.items || []) {
    detailMap.set(item.id, {
      durationSec: parseIsoDuration(item.contentDetails.duration),
      stats: {
        viewCount: parseStat(item.statistics?.viewCount),
        likeCount: parseStat(item.statistics?.likeCount),
        commentCount: parseStat(item.statistics?.commentCount),
      },
    });
  }
  for (const v of videos) {
    const d = detailMap.get(v.videoId);
    v.durationSec = d?.durationSec;
    v.viewCount = d?.stats.viewCount ?? null;
    v.likeCount = d?.stats.likeCount ?? null;
    v.commentCount = d?.stats.commentCount ?? null;
  }

  return videos;
}

/**
 * Fetch per-video engagement stats for many videos in one go (batches of 50,
 * 1 quota unit per batch). Returns a map keyed by video id. Used by the
 * `metrics` stage and the one-time backfill to snapshot view counts; videos
 * that are private/deleted simply don't appear in the response (and so are
 * absent from the map - the caller skips them).
 */
export async function getVideoStatsBatch(
  ids: string[],
): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).filter(Boolean).join(",");
    if (!chunk) continue;
    const data = await ytFetch<{
      items?: Array<{
        id: string;
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      }>;
    }>(`/videos?id=${chunk}&part=statistics`);
    for (const it of data.items || []) {
      out.set(it.id, {
        viewCount: parseStat(it.statistics?.viewCount),
        likeCount: parseStat(it.statistics?.likeCount),
        commentCount: parseStat(it.statistics?.commentCount),
      });
    }
  }
  return out;
}

/**
 * Paginate a channel's uploads playlist back to `sinceIso`, returning every
 * upload published on/after that cutoff (newest first). Unlike getRecentUploads
 * (single 50-item page), this walks pageTokens - needed to cover ~30 days of a
 * high-volume channel. Durations are batch-fetched in chunks of 50. `hardCap`
 * bounds a runaway (e.g. a firehose with thousands of uploads in the window).
 */
export async function getUploadsSince(
  uploadsPlaylistId: string,
  sinceIso: string,
  hardCap = 1500,
): Promise<YouTubeVideoSummary[]> {
  const since = new Date(sinceIso).getTime();
  const collected: YouTubeVideoSummary[] = [];
  let pageToken: string | undefined;

  // Uploads playlists are newest-first, so we can stop as soon as we cross the
  // cutoff. 40-page backstop (= 2000 items) against a malformed loop.
  for (let page = 0; page < 40 && collected.length < hardCap; page++) {
    const data = await ytFetch<{
      nextPageToken?: string;
      items?: Array<{
        contentDetails: { videoId: string; videoPublishedAt?: string };
        snippet: { title: string; publishedAt: string };
      }>;
    }>(
      `/playlistItems?playlistId=${uploadsPlaylistId}&part=snippet,contentDetails&maxResults=50${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`,
    );
    const items = data.items || [];
    if (items.length === 0) break;

    let crossedCutoff = false;
    for (const item of items) {
      const publishedAt =
        item.contentDetails.videoPublishedAt || item.snippet.publishedAt;
      if (new Date(publishedAt).getTime() < since) {
        crossedCutoff = true;
        break;
      }
      collected.push({
        videoId: item.contentDetails.videoId,
        publishedAt,
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
      });
    }
    if (crossedCutoff || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  // Batch durations (videos.list caps at 50 ids/call).
  for (let i = 0; i < collected.length; i += 50) {
    const chunk = collected.slice(i, i + 50);
    const details = await ytFetch<{
      items?: Array<{ id: string; contentDetails: { duration: string } }>;
    }>(`/videos?id=${chunk.map((v) => v.videoId).join(",")}&part=contentDetails`);
    const dmap = new Map<string, number>();
    for (const it of details.items || [])
      dmap.set(it.id, parseIsoDuration(it.contentDetails.duration));
    for (const v of chunk) v.durationSec = dmap.get(v.videoId);
  }

  return collected;
}

/**
 * Channels this channel "features" on its page - peers, network siblings,
 * friends-of-the-show, hand-picked by the host. A very high-signal adjacency
 * signal for finding competitors of an existing channel set. Costs 1 quota
 * unit per call. Returns the deduped list of featured channel IDs.
 */
export async function getFeaturedChannels(channelId: string): Promise<string[]> {
  const data = await ytFetch<{
    items?: Array<{
      snippet?: { type?: string };
      contentDetails?: { channels?: string[] };
    }>;
  }>(`/channelSections?channelId=${channelId}&part=snippet,contentDetails`);
  const out = new Set<string>();
  for (const item of data.items || []) {
    for (const id of item.contentDetails?.channels || []) out.add(id);
  }
  return [...out];
}

/**
 * Fetch title + subscriber count for many channels in one go (batches of 50,
 * 1 quota unit per batch). Returns a map keyed by channel id.
 */
export async function getChannelDetailsBatch(
  ids: string[],
): Promise<Map<string, { title: string; subscriberCount: number; description: string }>> {
  const out = new Map<string, { title: string; subscriberCount: number; description: string }>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).join(",");
    if (!chunk) continue;
    const data = await ytFetch<{
      items?: Array<{
        id: string;
        snippet: { title: string; description: string };
        statistics?: { subscriberCount?: string };
      }>;
    }>(`/channels?id=${chunk}&part=snippet,statistics`);
    for (const ch of data.items || []) {
      out.set(ch.id, {
        title: ch.snippet.title,
        description: ch.snippet.description || "",
        subscriberCount: parseInt(ch.statistics?.subscriberCount || "0", 10),
      });
    }
  }
  return out;
}

/**
 * Pull the existing transcript for a YouTube video via Supadata's API.
 *
 * Uses `mode=native` - fetch the existing caption track if any, do NOT
 * trigger AI generation. AI generation costs 2 credits/min vs 1 credit
 * for a native fetch (success or unavailable), and at our volume we'd
 * rather just skip videos without captions than pay to generate
 * potentially-inaccurate ones.
 *
 * Returns a discriminated result so the caller can tell the two failure
 * modes apart - they must NOT be handled identically:
 *   - { ok: true, text }                    captions fetched
 *   - { ok: false, retriable: false }       definitively no captions / bad
 *                                           video → terminal, don't retry
 *   - { ok: false, retriable: true }        transient (5xx / 429 / network)
 *                                           → leave pending and retry later
 *
 * The old version collapsed all three into `string | null`, so a one-off
 * Supadata blip (2026-06-02) marked ~95 episodes permanently `failed` even
 * though their captions were perfectly fetchable. See [[transcribe-retry-bug]].
 *
 * Pricing: 1 credit per request regardless of result (success, 206
 * unavailable, or 404 video-not-found).
 */
export type TranscriptFetch =
  | { ok: true; text: string; segments?: TranscriptSegment[] }
  | { ok: false; retriable: boolean; reason: string };

/** HTTP statuses worth retrying: rate-limit, timeout, quota, server errors. */
function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 402 || status >= 500;
}

export async function getVideoTranscript(videoId: string): Promise<TranscriptFetch> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // No `text=true`: that flattens the response to a plain string and drops the
  // per-chunk timing. Without it the same 1-credit call returns `content` as an
  // array of { text, offset(ms), duration(ms) } chunks, which we keep as
  // segments so classify can place each mention on the video timeline (v0.31.0).
  const apiUrl =
    `https://api.supadata.ai/v1/transcript?` +
    `url=${encodeURIComponent(videoUrl)}&mode=native`;

  try {
    const res = await fetch(apiUrl, {
      headers: { "x-api-key": env.supadataApiKey },
    });

    // 206 = transcript unavailable for this video (still costs 1 credit
    // and is a legitimate "no captions" answer, not an error) → terminal.
    if (res.status === 206) {
      console.warn(`[YT transcript] no captions available for ${videoId}`);
      return { ok: false, retriable: false, reason: "no-captions" };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retriable = isRetriableStatus(res.status);
      console.error(
        `[YT transcript] supadata ${res.status} for ${videoId} ` +
          `(${retriable ? "transient, will retry" : "terminal"}): ${text.slice(0, 200)}`,
      );
      return { ok: false, retriable, reason: `http-${res.status}` };
    }

    const data = (await res.json()) as {
      content?: string | Array<{ text?: string; offset?: number; duration?: number }>;
      lang?: string;
    };

    let text: string;
    let segments: TranscriptSegment[] | undefined;
    if (Array.isArray(data.content)) {
      segments = data.content
        .filter((c) => c && typeof c.text === "string" && c.text.length > 0)
        .map((c) => ({
          t: Math.max(0, Math.floor((Number(c.offset) || 0) / 1000)),
          x: String(c.text),
        }));
      text = segments.map((s) => s.x).join("\n");
    } else {
      // Defensive: if Supadata ever returns a flat string here, keep working
      // (just without timestamps for that episode).
      text = typeof data.content === "string" ? data.content : "";
    }

    if (!text || text.trim().length === 0) {
      // 200 with no content is a "no captions" answer, not a transient error.
      console.warn(`[YT transcript] supadata empty content for ${videoId}`);
      return { ok: false, retriable: false, reason: "empty" };
    }

    return { ok: true, text, segments };
  } catch (e: any) {
    // Network-level failure (DNS, connection reset, timeout) - transient.
    const errClass = e?.constructor?.name || "Error";
    const errMsg = e?.message || String(e);
    console.error(`[YT transcript] ${errClass} for ${videoId} (transient): ${errMsg}`);
    return { ok: false, retriable: true, reason: errMsg.slice(0, 80) };
  }
}
