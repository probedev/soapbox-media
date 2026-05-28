/**
 * YouTube Data API v3 helpers + Supadata transcript fetcher.
 *
 * We use raw fetch() against YouTube's REST API rather than the heavier
 * `googleapis` SDK — we only need a small subset of endpoints and avoiding
 * the SDK keeps deps lean.
 *
 * Transcripts are fetched via Supadata's managed API (v0.6.14) rather
 * than the previous `youtube-transcript` library, which had two
 * compounding failure modes:
 *   1. Library bug — returned "Transcript is disabled" for videos that
 *      actually had captions on YouTube. Documented issue, mid-2024+.
 *   2. Cloud IP blocking — even when the library worked, YouTube
 *      throttled requests from Vercel/GH Actions egress pools.
 * Supadata is just an HTTPS call from anywhere — no scraping, no IP
 * issues, no library maintenance. ~$17/mo at our volume on the Pro plan.
 *
 * Quota notes: each `channels.list` call costs 1 unit, `playlistItems.list`
 * costs 1 unit. Default daily quota is 10,000 units. Our 23 YT channels
 * polled hourly = ~552 units/day. Well under quota.
 */
import { env } from "./env";

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

  // Step 2: batch-fetch durations via videos.list
  const ids = videos.map((v) => v.videoId).join(",");
  const detailsData = await ytFetch<{
    items?: Array<{
      id: string;
      contentDetails: { duration: string };
    }>;
  }>(`/videos?id=${ids}&part=contentDetails`);

  const durationMap = new Map<string, number>();
  for (const item of detailsData.items || []) {
    durationMap.set(item.id, parseIsoDuration(item.contentDetails.duration));
  }
  for (const v of videos) {
    v.durationSec = durationMap.get(v.videoId);
  }

  return videos;
}

/**
 * Channels this channel "features" on its page — peers, network siblings,
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
 * Uses `mode=native` — fetch the existing caption track if any, do NOT
 * trigger AI generation. AI generation costs 2 credits/min vs 1 credit
 * for a native fetch (success or unavailable), and at our volume we'd
 * rather just skip videos without captions than pay to generate
 * potentially-inaccurate ones.
 *
 * Returns null if no captions exist, the video is private, or the API
 * call fails. Logs the failure mode so we can distinguish "no captions
 * available" from genuine errors.
 *
 * Pricing: 1 credit per request regardless of result (success, 206
 * unavailable, or 404 video-not-found). At 100 episodes/day this is
 * ~3000 credits/month — fits the $17/mo Pro plan.
 */
export async function getVideoTranscript(videoId: string): Promise<string | null> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const apiUrl =
    `https://api.supadata.ai/v1/transcript?` +
    `url=${encodeURIComponent(videoUrl)}&text=true&mode=native`;

  try {
    const res = await fetch(apiUrl, {
      headers: { "x-api-key": env.supadataApiKey },
    });

    // 206 = transcript unavailable for this video (still costs 1 credit
    // and is a legitimate "no captions" answer, not an error)
    if (res.status === 206) {
      console.warn(`[YT transcript] no captions available for ${videoId}`);
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[YT transcript] supadata ${res.status} for ${videoId}: ${text.slice(0, 200)}`,
      );
      return null;
    }

    const data = (await res.json()) as {
      content?: string;
      lang?: string;
    };

    if (!data.content || data.content.trim().length === 0) {
      console.warn(`[YT transcript] supadata empty content for ${videoId}`);
      return null;
    }

    return data.content;
  } catch (e: any) {
    const errClass = e?.constructor?.name || "Error";
    const errMsg = e?.message || String(e);
    console.error(`[YT transcript] ${errClass} for ${videoId}: ${errMsg}`);
    return null;
  }
}
