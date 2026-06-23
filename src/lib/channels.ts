/**
 * Channel-onboarding lib - adds a new YouTube channel to the panel and
 * deep-ingests its recent history. Shared by the CLI tool
 * (`scripts/backfill-channel-history.ts`) and the `/admin/channels` admin
 * action. Encapsulates: handle parsing, YT resolve + sub-floor check,
 * dedup-against-panel, insert, and historical backfill.
 *
 * Covers both platforms: addYouTubeChannel (YT resolve + sub-floor) and
 * addPodcastChannel (PodScan resolve + inline-transcript ingest). Podcast
 * onboarding consolidates logic that was copied across the retired seed scripts.
 */
import { createServiceClient } from "./db";
import { resolveChannelByHandle, getRecentUploads, getChannelDetailsBatch } from "./youtube";
import {
  searchPodcasts,
  getPodcastById,
  getPodcastEpisodes,
  pickPodcastId,
  pickPodcastTitle,
  pickPodcastReach,
  episodeSourceUrl,
  type PodscanPodcast,
  type PodscanEpisode,
} from "./podscan";
import { getAnthropicClient, MODEL_RATIONALE } from "./anthropic";
import type { Cohort } from "./cohort";
import { SUB_FLOOR } from "./channel-vet";
import { matchChannel, nameMatches } from "./channel-dedup";
import { normalizeTitle } from "./dedup";

// Admits curated short-form (e.g. NowThis Impact). Lowered from 180s; the YT
// sub floor (SUB_FLOOR) is the single source of truth, imported from channel-vet.
const MIN_DURATION_SEC = 126;

const LEAN_LABEL = { L: "Left", M: "Middle / cross-cutting", R: "Right" } as const;

/**
 * Draft a one-sentence channel description in the site's house voice, given the
 * channel's own metadata + the editorially-assigned lean. The admin EDITS this
 * draft rather than writing from scratch - see [[admin-channel-autodescribe]].
 *
 * House style (from the existing panel): one line, ~12-25 words, concrete,
 * posture-first; semicolon-separated clauses; names the host/network and the
 * format; describes political character, never hypes. No markdown, no quotes.
 * Falls back to a minimal template if the model call fails - generation must
 * never block adding a channel.
 */
export async function generateChannelRationale(opts: {
  title: string;
  description: string;
  lean: "L" | "M" | "R";
  recentTitles?: string[];
}): Promise<string> {
  const { title, description, lean, recentTitles = [] } = opts;
  const examples = [
    "Flagship Democratic-adjacent podcast; ex-Obama staffers.",
    "Long-form interviews; broadly non-partisan, contrarian-friendly.",
    "Krystal Ball (L) + Saagar Enjeti (R-populist); explicit heterodox bridge show.",
    "Hard-right cultural commentary; trans/gender focus.",
    "CBS News' flagship Sunday newsmagazine; long-running investigative reports and profiles. Institutional, center-of-the-dial posture.",
  ];
  const prompt =
    `Write ONE sentence (max ~25 words) describing this political show for a ` +
    `media-bias tracker, matching the house style of these examples:\n` +
    examples.map((e) => `- ${e}`).join("\n") +
    `\n\nChannel: ${title}\nEditorial lean: ${LEAN_LABEL[lean]}\n` +
    `Their own description: ${(description || "(none)").slice(0, 800)}\n` +
    (recentTitles.length
      ? `Recent video titles: ${recentTitles.slice(0, 8).join(" | ").slice(0, 600)}\n`
      : "") +
    `\nReturn ONLY the sentence - no preamble, no quotes, no markdown. Describe ` +
    `the host/network, format, and political posture. Do not invent facts not ` +
    `supported by the inputs.`;

  try {
    const res = await getAnthropicClient().messages.create({
      model: MODEL_RATIONALE,
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .replace(/^["'\s]+|["'\s]+$/g, "");
    if (text) return text;
  } catch {
    // fall through to template
  }
  return `${title}; ${LEAN_LABEL[lean]} posture. (Auto-draft failed - please edit.)`;
}

export interface ChannelPreview {
  name: string;
  subscriberCount: number;
  videoCount: number;
  draftRationale: string;
  alreadyInPanel: boolean;
  belowFloor: boolean;
  /** Set when the channel being added looks like the same show as an existing
   *  channel on another feed (e.g. its podcast). The cross-platform dedup only
   *  links feeds with the SAME channel name and matching normalized titles, so a
   *  differently-named or differently-titled mirror (the common case: a YT
   *  "Host | Title | Show 1408" wrapper vs a bare podcast title, or an "Ep. N -"
   *  prefix) would silently DOUBLE-COUNT in the Index. The operator must decide.
   *  See [[cross-platform-dedup]]. */
  possibleMirror?: MirrorMatch;
}

export interface MirrorMatch {
  channelName: string;
  platform: string;
  /** How many of the candidate's recent uploads matched an episode on this
   *  channel by same publish date + title containment. */
  matched: number;
  sampleSize: number;
}

/**
 * Best-effort: does this YouTube channel look like a re-post of a show already
 * tracked on another feed? Matches the candidate's recent uploads against
 * existing active channels' episodes by same publish date + normalized-title
 * containment (either direction, to catch wrapper/prefix differences the strict
 * dedup misses). Returns the strongest matching channel, or null. Never throws.
 */
async function detectCrossPlatformMirror(
  db: ReturnType<typeof createServiceClient>,
  uploads: { title: string; publishedAt: string }[],
  excludePlatformId: string,
): Promise<MirrorMatch | null> {
  const recent = uploads.filter((u) => u.title && u.publishedAt).slice(0, 8);
  if (recent.length < 2) return null;
  const cand = recent.map((u) => ({ d: u.publishedAt.slice(0, 10), n: normalizeTitle(u.title) }));

  // Query per candidate publish date (a small slice of the panel) rather than the
  // whole date range: the range can exceed the 1000-row page cap and truncate the
  // very rows we want. Same-day cross-posts are matched by normalized-title
  // containment in either direction, to catch the YT "Host | Title | Show N"
  // wrapper or "Ep. N -" prefix that the strict ingest dedup misses.
  const perDay = await Promise.all(
    cand.map(async (c) => {
      const next = new Date(c.d + "T00:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      const { data } = await db
        .from("episodes")
        .select("title, channels(name, platform, platform_id, active)")
        .gte("published_at", c.d)
        .lt("published_at", next.toISOString())
        .limit(500);
      return { c, rows: (data ?? []) as any[] };
    }),
  );

  // Count, per existing channel, how many distinct candidate episodes it mirrors.
  const tally = new Map<string, { platform: string; matched: number }>();
  for (const { c, rows } of perDay) {
    const matchedHere = new Set<string>();
    for (const row of rows) {
      const ch = Array.isArray(row.channels) ? row.channels[0] : row.channels;
      if (!ch || !ch.active || ch.platform_id === excludePlatformId) continue;
      if (matchedHere.has(ch.name)) continue;
      const rn = normalizeTitle(row.title || "");
      if (rn.length < 6) continue;
      if (c.n === rn || c.n.includes(rn) || rn.includes(c.n)) {
        matchedHere.add(ch.name);
        const cur = tally.get(ch.name) ?? { platform: ch.platform, matched: 0 };
        cur.matched += 1;
        tally.set(ch.name, cur);
      }
    }
  }

  let best: MirrorMatch | null = null;
  for (const [channelName, v] of tally) {
    if (v.matched >= 2 && (!best || v.matched > best.matched)) {
      best = { channelName, platform: v.platform, matched: v.matched, sampleSize: recent.length };
    }
  }
  return best;
}

/**
 * Read-only resolve + draft step for the admin add-channel form: resolves the
 * handle, reports floor/dup status, and auto-drafts a rationale the admin can
 * edit before committing via addYouTubeChannel. Never writes.
 */
export async function previewYouTubeChannel(
  handleOrUrl: string,
  lean: "L" | "M" | "R",
): Promise<ChannelPreview> {
  const handle = extractYouTubeHandle(handleOrUrl);
  if (!handle) {
    throw new Error("Couldn't parse a YouTube handle. Try `@channelname` or a youtube.com/@... URL.");
  }
  const yt = await resolveChannelByHandle(handle);
  if (!yt) throw new Error(`YouTube channel @${handle} not found.`);

  const db = createServiceClient();
  const { data: existing } = await db
    .from("channels")
    .select("id")
    .eq("platform", "youtube")
    .eq("platform_id", yt.id)
    .maybeSingle();

  // Pull a few recent uploads: used both for richer rationale grounding and for
  // the cross-platform mirror check (best-effort - never blocks the preview).
  let recentTitles: string[] = [];
  let possibleMirror: MirrorMatch | undefined;
  try {
    const vids = await getRecentUploads(yt.uploadsPlaylistId, 8);
    recentTitles = vids.map((v) => v.title).filter(Boolean);
    possibleMirror = (await detectCrossPlatformMirror(db, vids, yt.id)) ?? undefined;
  } catch {
    /* non-fatal */
  }

  const draftRationale = await generateChannelRationale({
    title: yt.title,
    description: yt.description,
    lean,
    recentTitles,
  });

  return {
    name: yt.title,
    subscriberCount: yt.subscriberCount,
    videoCount: yt.videoCount,
    draftRationale,
    alreadyInPanel: !!existing,
    belowFloor: yt.subscriberCount < SUB_FLOOR,
    possibleMirror,
  };
}

/** Pull a YT handle out of a raw input (handle, @handle, or full URL). */
export function extractYouTubeHandle(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (t.startsWith("@")) return t.slice(1);
  const m = t.match(/youtube\.com\/@([\w.\-]+)/i);
  if (m) return m[1];
  // bare word (e.g. "MeidasTouch") - treat as a handle
  if (/^[\w.\-]+$/.test(t)) return t;
  return null;
}

export interface AddChannelInput {
  handleOrUrl: string;
  lean: "L" | "M" | "R";
  /** One-sentence rationale for the lean assignment - shown on /channels.
   *  Required so the panel surface stays informative. */
  rationale: string;
  /** Cohort placement: independent (creator/native) vs legacy (traditional
   *  institution). Defaults to independent - most additions are creators. */
  cohort?: Cohort;
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
      `${yt.title} has ${yt.subscriberCount.toLocaleString()} subscribers - below the ${SUB_FLOOR.toLocaleString()} floor.`,
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
      cohort: input.cohort ?? "independent",
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

/**
 * Add a YouTube channel by its channel id (not handle) + deep-ingest history.
 * Used by `channels promote`, whose featured-channel candidates carry the
 * channel id rather than a handle. The uploads playlist id follows YouTube's
 * stable UC->UU convention, so no extra resolve call is needed.
 */
export async function addYouTubeChannelById(input: {
  channelId: string;
  lean: "L" | "M" | "R";
  rationale?: string;
  cohort?: Cohort;
  nameOverride?: string;
  reachOverride?: number;
  backfillCount?: number;
}): Promise<AddChannelResult> {
  const { channelId } = input;
  const details = await getChannelDetailsBatch([channelId]);
  const d = details.get(channelId);
  if (!d) throw new Error(`YouTube channel ${channelId} not found.`);

  const reach = input.reachOverride ?? d.subscriberCount;
  if (reach < SUB_FLOOR) {
    throw new Error(
      `${d.title} has ${d.subscriberCount.toLocaleString()} subscribers - below the ${SUB_FLOOR.toLocaleString()} floor.`,
    );
  }

  const db = createServiceClient();
  const { data: existing } = await db
    .from("channels")
    .select("id, name")
    .eq("platform", "youtube")
    .eq("platform_id", channelId)
    .maybeSingle();
  if (existing) throw new Error(`"${existing.name}" is already in the panel.`);

  const rationale =
    input.rationale?.trim() ||
    (await generateChannelRationale({ title: d.title, description: d.description, lean: input.lean }));

  const { data: inserted, error: insErr } = await db
    .from("channels")
    .insert({
      name: input.nameOverride?.trim() || d.title,
      platform: "youtube",
      platform_id: channelId,
      political_lean: input.lean,
      cohort: input.cohort ?? "independent",
      reach,
      classification_rationale: rationale,
      active: true,
    })
    .select("id, name")
    .single();
  if (insErr || !inserted) throw new Error(`Insert failed: ${insErr?.message || "unknown"}`);

  // Deep-ingest via the UC->UU uploads-playlist convention (best-effort).
  let videos: Awaited<ReturnType<typeof getRecentUploads>> = [];
  if (channelId.startsWith("UC")) {
    const uploadsPlaylistId = "UU" + channelId.slice(2);
    try {
      videos = await getRecentUploads(uploadsPlaylistId, input.backfillCount ?? 30);
    } catch {
      /* best-effort: the channel is still added; the next cron ingest fills in */
    }
  }
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
    subscriberCount: reach,
    fetched: videos.length,
    kept: longEnough.length,
    upserted,
  };
}

export interface AddPodcastInput {
  /** PodScan search query (typically the show name). Ignored if podcastId set. */
  query?: string;
  /** Explicit PodScan podcast id - skips search. */
  podcastId?: string;
  lean: "L" | "M" | "R";
  /** One-sentence rationale; auto-drafted in house voice if omitted. */
  rationale?: string;
  cohort?: Cohort;
  nameOverride?: string;
  /** Editorial reach override; else best-effort from PodScan (300K placeholder). */
  reachOverride?: number;
  /** Max episodes to deep-ingest after adding. Default 30. */
  backfillCount?: number;
}

export interface AddPodcastResult {
  channelId: string;
  name: string;
  reach: number;
  fetched: number;
  kept: number;
  upserted: number;
  transcripts: number;
}

// A feed whose newest episode is older than this is treated as dead and never
// onboarded (PodScan returns many abandoned/duplicate feeds for a show name).
const FEED_STALE_LIMIT_MS = 120 * 24 * 60 * 60 * 1000;

/** Query variants for a show name: normalize curly apostrophes (which break
 *  PodScan search) and add a shortened form, so "Bill O'Reilly's No Spin News
 *  and Analysis" still resolves. */
function podcastQueryVariants(q: string): string[] {
  const straight = q.replace(/[‘’ʼ`']/g, "'");
  const noApos = q.replace(/[‘’ʼ`']/g, "");
  const words = q.split(/\s+/).filter(Boolean);
  const variants = [q, straight, noApos];
  if (words.length > 4) variants.push(words.slice(0, 4).join(" "));
  return [...new Set(variants.map((v) => v.trim()).filter(Boolean))];
}

/**
 * Resolve a podcast NAME to its LIVE PodScan feed. Searches several query
 * variants, keeps only feeds whose title matches the query (anchor-gated, so a
 * wrong feed can't sneak in - this is what onboarded "Hell and High Water" for
 * "Impolitic"), and picks the one with the NEWEST episode. Rejects feeds with
 * no recent episode so dead/abandoned feeds (2018-era Anderson Cooper, empty
 * feeds) are never onboarded. Mirrors the proven recover-feeds.ts logic.
 */
export async function resolveLiveFeed(query: string): Promise<PodscanPodcast> {
  const seen = new Map<string, { pod: PodscanPodcast; latest: number }>();
  for (const q of podcastQueryVariants(query)) {
    let results: PodscanPodcast[] = [];
    try {
      results = await searchPodcasts(q);
    } catch {
      continue;
    }
    for (const p of results.slice(0, 5)) {
      const id = pickPodcastId(p);
      if (!id || seen.has(id)) continue;
      if (!nameMatches(query, pickPodcastTitle(p))) continue; // title MUST match
      let latest = 0;
      try {
        const eps = await getPodcastEpisodes(id, 1);
        const d = eps[0]?.posted_at || eps[0]?.published_at || eps[0]?.created_at;
        latest = d ? Date.parse(String(d)) || 0 : 0;
      } catch {
        /* leave latest = 0 */
      }
      seen.set(id, { pod: p, latest });
    }
  }
  let best: { pod: PodscanPodcast; latest: number } | null = null;
  for (const v of seen.values()) if (!best || v.latest > best.latest) best = v;
  if (!best) throw new Error(`No PodScan title match for "${query}".`);
  if (!best.latest) throw new Error(`No live feed for "${query}" (no datable episodes).`);
  if (Date.now() - best.latest > FEED_STALE_LIMIT_MS) {
    throw new Error(
      `No live feed for "${query}" (freshest episode ${Math.floor((Date.now() - best.latest) / 86_400_000)}d old).`,
    );
  }
  return best.pod;
}

/**
 * Add a podcast channel to the panel + deep-ingest recent episodes with their
 * inline PodScan transcripts. The podcast counterpart to addYouTubeChannel.
 * No reach floor: podcast reach is editorial, never floor-gated. Throws on
 * failure with a user-readable message.
 */
export async function addPodcastChannel(input: AddPodcastInput): Promise<AddPodcastResult> {
  // 1. Resolve the podcast (explicit id, or freshness-anchored live-feed search).
  let pod: PodscanPodcast | null = null;
  if (input.podcastId) {
    pod = (await getPodcastById(input.podcastId)) ?? ({ podcast_id: input.podcastId } as PodscanPodcast);
  } else if (input.query?.trim()) {
    pod = await resolveLiveFeed(input.query.trim());
  } else {
    throw new Error("Provide a PodScan query or podcastId.");
  }

  const podcastId = pickPodcastId(pod);
  if (!podcastId) throw new Error("Resolved podcast has no usable PodScan id.");
  const name = input.nameOverride?.trim() || pickPodcastTitle(pod);
  const reach = input.reachOverride ?? pickPodcastReach(pod);

  // 2. Dedup against the panel. A same-platform match is a real duplicate;
  //    a cross-platform same-name row is a sibling (allowed - the show is on
  //    both YouTube and a podcast feed by design). Unpaginated select is safe
  //    here: the panel is bounded well under the 1000-row cap (~250 shows).
  const db = createServiceClient();
  const { data: existing } = await db
    .from("channels")
    .select("id, name, platform, platform_id");
  const dup = matchChannel(
    { name, platform: "podcast", platform_id: podcastId },
    (existing ?? []) as { id: string; name: string; platform: "youtube" | "podcast"; platform_id: string | null }[],
  );
  if (dup.match && dup.samePlatform) {
    throw new Error(`"${dup.match.name}" is already in the panel.`);
  }

  // 3. Fetch episodes (for rationale grounding + backfill).
  const N = input.backfillCount ?? 30;
  const eps = await getPodcastEpisodes(podcastId, N).catch(() => [] as PodscanEpisode[]);

  // 4. Rationale (auto-draft if not supplied).
  const rationale =
    input.rationale?.trim() ||
    (await generateChannelRationale({
      title: name,
      description: pod.description || "",
      lean: input.lean,
      recentTitles: eps.slice(0, 8).map((e) => e.episode_title || e.title || "").filter(Boolean),
    }));

  // 5. Insert the channel.
  const { data: inserted, error: insErr } = await db
    .from("channels")
    .insert({
      name,
      platform: "podcast",
      platform_id: podcastId,
      political_lean: input.lean,
      cohort: input.cohort ?? "independent",
      reach,
      classification_rationale: rationale,
      active: true,
    })
    .select("id, name")
    .single();
  if (insErr || !inserted) throw new Error(`Insert failed: ${insErr?.message || "unknown"}`);

  // 6. Deep-ingest episodes + inline transcripts.
  let upserted = 0;
  let transcripts = 0;
  const seenUrl = new Set<string>();
  for (const ep of eps) {
    const url = episodeSourceUrl(ep);
    const published = ep.posted_at || ep.published_at || ep.created_at;
    const duration = Number(ep.episode_duration ?? ep.duration ?? 0);
    // Podcasts are long-form; only drop when the duration is KNOWN and too short.
    // A missing/0 duration from PodScan must not filter the whole feed out.
    if (!url || !published || (duration > 0 && duration < MIN_DURATION_SEC) || seenUrl.has(url)) continue;
    seenUrl.add(url);
    const { data: er } = await db
      .from("episodes")
      .upsert(
        {
          channel_id: inserted.id,
          title: String(ep.episode_title || ep.title || "(untitled)").slice(0, 500),
          published_at: published,
          source_url: url,
          duration_sec: Math.round(duration) || null,
        },
        { onConflict: "channel_id,source_url", ignoreDuplicates: false },
      )
      .select();
    if (!er?.[0]) continue;
    upserted++;
    const text = ep.episode_transcript || ep.transcript || ep.text;
    if (text && String(text).trim()) {
      const { error: te } = await db
        .from("transcripts")
        .upsert(
          { episode_id: er[0].id, text: String(text), provider: "podscan" },
          { onConflict: "episode_id", ignoreDuplicates: false },
        );
      if (!te) {
        transcripts++;
        await db.from("episodes").update({ transcript_status: "fetched" }).eq("id", er[0].id);
      }
    }
  }

  return {
    channelId: inserted.id,
    name: inserted.name,
    reach,
    fetched: eps.length,
    kept: upserted,
    upserted,
    transcripts,
  };
}
