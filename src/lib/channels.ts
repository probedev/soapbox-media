/**
 * Channel-onboarding lib — adds a new YouTube channel to the panel and
 * deep-ingests its recent history. Shared by the CLI tool
 * (`scripts/backfill-channel-history.ts`) and the `/admin/channels` admin
 * action. Encapsulates: handle parsing, YT resolve + sub-floor check,
 * dedup-against-panel, insert, and historical backfill.
 *
 * v1 scope: YouTube only. Podcast onboarding (via PodScan search) is a
 * planned follow-on; the data model already supports it.
 */
import { createServiceClient } from "./db";
import { resolveChannelByHandle, getRecentUploads } from "./youtube";

const MIN_DURATION_SEC = 180;
const SUB_FLOOR = 300_000;

/** Pull a YT handle out of a raw input (handle, @handle, or full URL). */
export function extractYouTubeHandle(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (t.startsWith("@")) return t.slice(1);
  const m = t.match(/youtube\.com\/@([\w.\-]+)/i);
  if (m) return m[1];
  // bare word (e.g. "MeidasTouch") — treat as a handle
  if (/^[\w.\-]+$/.test(t)) return t;
  return null;
}

export interface AddChannelInput {
  handleOrUrl: string;
  lean: "L" | "M" | "R";
  /** One-sentence rationale for the lean assignment — shown on /channels.
   *  Required so the panel surface stays informative. */
  rationale: string;
  nameOverride?: string;
  /** Max episodes to deep-ingest after adding. Default 30. */
  backfillCount?: number;
}

export interface AddChannelResult {
  channelId: string;
  name: string;
  subscriberCount: number;
  fetched: number;
  kept: number;
  upserted: number;
}

/**
 * Add a YouTube channel to the panel + deep-ingest history.
 * Throws on failure with a user-readable message.
 */
export async function addYouTubeChannel(input: AddChannelInput): Promise<AddChannelResult> {
  const handle = extractYouTubeHandle(input.handleOrUrl);
  if (!handle) {
    throw new Error("Couldn't parse a YouTube handle from that input. Try `@channelname` or a youtube.com/@... URL.");
  }

  const yt = await resolveChannelByHandle(handle);
  if (!yt) throw new Error(`YouTube channel @${handle} not found.`);
  if (yt.subscriberCount < SUB_FLOOR) {
    throw new Error(
      `${yt.title} has ${yt.subscriberCount.toLocaleString()} subscribers — below the ${SUB_FLOOR.toLocaleString()} floor.`,
    );
  }

  const db = createServiceClient();
  const { data: existing } = await db
    .from("channels")
    .select("id, name")
    .eq("platform", "youtube")
    .eq("platform_id", yt.id)
    .maybeSingle();
  if (existing) {
    throw new Error(`"${existing.name}" is already in the panel.`);
  }

  if (!input.rationale?.trim()) {
    throw new Error("Provide a one-sentence rationale (shown on /channels).");
  }

  const { data: inserted, error: insErr } = await db
    .from("channels")
    .insert({
      name: input.nameOverride?.trim() || yt.title,
      platform: "youtube",
      platform_id: yt.id,
      political_lean: input.lean,
      reach: yt.subscriberCount,
      classification_rationale: input.rationale.trim(),
      active: true,
    })
    .select("id, name")
    .single();
  if (insErr || !inserted) throw new Error(`Insert failed: ${insErr?.message || "unknown"}`);

  // Deep-ingest history so the channel doesn't start with only the next
  // daily ingest's 3 episodes.
  const N = input.backfillCount ?? 30;
  const videos = await getRecentUploads(yt.uploadsPlaylistId, N);
  const longEnough = videos.filter((v) => (v.durationSec ?? 0) >= MIN_DURATION_SEC);
  let upserted = 0;
  for (const v of longEnough) {
    const { error, data } = await db
      .from("episodes")
      .upsert(
        {
          channel_id: inserted.id,
          title: v.title,
          published_at: v.publishedAt,
          source_url: v.url,
          duration_sec: v.durationSec ?? null,
        },
        { onConflict: "channel_id,source_url", ignoreDuplicates: false },
      )
      .select();
    if (!error && data && data.length > 0) upserted++;
  }

  return {
    channelId: inserted.id,
    name: inserted.name,
    subscriberCount: yt.subscriberCount,
    fetched: videos.length,
    kept: longEnough.length,
    upserted,
  };
}
