/**
 * YouTube Data API v3 helpers.
 *
 * We use raw fetch() against the REST API rather than the heavier `googleapis`
 * SDK — we only need a small subset of endpoints and avoiding the SDK keeps
 * deps lean.
 *
 * Quota notes: each `channels.list` call costs 1 unit, `playlistItems.list`
 * costs 1 unit. Default daily quota is 10,000 units. Our 23 YT channels
 * polled hourly = ~552 units/day. Well under quota.
 */
import { env } from "./env";
import { YoutubeTranscript } from "youtube-transcript";

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
 * Pull the auto-generated transcript for a YouTube video.
 * Returns null if no captions exist or the fetch fails.
 */
export async function getVideoTranscript(videoId: string): Promise<string | null> {
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    if (!items || items.length === 0) return null;
    return items.map((i) => i.text).join(" ");
  } catch {
    return null;
  }
}
