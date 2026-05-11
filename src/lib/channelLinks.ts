/**
 * Construct an external "view source" URL for a channel.
 *
 * - YouTube channels: direct link to youtube.com/channel/<UCxxx>
 * - Podcast channels: Apple Podcasts search URL (we don't store iTunes IDs yet
 *   so we use a search fallback. v2 could store apple/spotify IDs returned by
 *   PodScan and link directly.)
 */
export function getChannelExternalUrl(channel: {
  platform: string;
  platform_id: string;
  name: string;
}): { url: string; label: string; provider: "YouTube" | "Apple Podcasts" | "External" } {
  if (channel.platform === "youtube") {
    return {
      url: `https://www.youtube.com/channel/${channel.platform_id}`,
      label: "Visit on YouTube",
      provider: "YouTube",
    };
  }
  if (channel.platform === "podcast") {
    return {
      url: `https://podcasts.apple.com/search?term=${encodeURIComponent(channel.name)}`,
      label: "Find on Apple Podcasts",
      provider: "Apple Podcasts",
    };
  }
  return {
    url: "#",
    label: "External link unavailable",
    provider: "External",
  };
}
