/**
 * Pipeline stages (ingest → transcribe → classify → score) extracted from the
 * cron route so each can run as its OWN Vercel cron with a full 300s budget.
 * The combined run hit the 300s timeout once classify started doing real work
 * (v0.6.29), which starved `score` and skipped the usage_log write (504s,
 * 2026-05-26). Each stage reads inputs from the DB and writes outputs to the DB
 * and never calls another stage (see ARCHITECTURE.md) - which is exactly what
 * lets them split cleanly.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db";
import { getRecentUploads, getVideoTranscript, getChannelDetailsBatch } from "@/lib/youtube";
import { getPodcastEpisodes } from "@/lib/podscan";
import { classifyTranscript, type IssueDef } from "@/modules/classify";
import { scoreClassification, scoreEmergingMention, EMERGING_SCORE_PROMPT_VERSION } from "@/modules/score";
import { MODEL_CLASSIFY, MODEL_SCORE } from "@/lib/anthropic";
import { estimateCostUsd } from "@/lib/pricing";
import { dedupKey, loadSiblingEpisodeKeys } from "@/lib/dedup";
import { mapPool } from "@/lib/concurrency";
import { getEmergingBoard } from "@/lib/discovery";

/** Shared cron auth: returns a NextResponse to short-circuit on failure, else null. */
export function assertCronAuth(request: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}

// Lowered from 180s to admit curated short-form (e.g. NowThis Impact). Shorter
// transcripts also classify cheaper per episode.
export const MIN_DURATION_SEC = 126;
// Cost lever for the 250-show panel: at ~265-270 active rows, 3/run breaches the
// $1k/mo budget (~$1.0k+); 2/run holds it near ~$785/mo. Set BEFORE the +70.
export const INGEST_PER_CHANNEL = 2;
// Transcribe runs through a concurrency pool too. Each Supadata call takes a
// few seconds, so concurrency 8 keeps the request rate ~2/s - well under the
// 10/s Supadata limit. Higher per-run limit since it's no longer serial.
export const TRANSCRIBE_LIMIT = 100;
export const TRANSCRIBE_CONCURRENCY = 8;
// A transient transcript fetch (5xx/429/network) leaves the episode `pending`
// and bumps `transcript_attempts`; only after this many tries do we give up and
// mark it `failed`. Prevents a one-off Supadata blip from permanently stranding
// episodes (the 2026-06-02 incident) while still bounding wasted credits on a
// video that errors every time. A "no captions" answer is terminal immediately,
// regardless of attempt count.
export const MAX_TRANSCRIPT_ATTEMPTS = 3;
// Classify (Sonnet) and score (Haiku) now process episodes/mentions through a
// bounded-concurrency pool instead of one-at-a-time, so the per-run LIMITs are
// higher - the wall-clock budget below is the real cap. Concurrency is sized
// for an Anthropic Max-tier account; dial down if 429s appear.
export const CLASSIFY_LIMIT = 60;
export const CLASSIFY_CONCURRENCY = 10;
// SCORE_LIMIT 240 → 720 (v0.6.82): the channel expansion tripled episode
// intake (~470 eps/day × ~10 mentions/ep ≈ 4,700 mentions/day) and 8×240 =
// 1,920/day fell ~2.5× short - every run saturated and partial-scored
// episodes piled up in /log. 240 mentions took ~35s, so 720 fits the 240s
// budget with margin; the time-budget guard below is the real backstop.
export const SCORE_LIMIT = 720;
export const SCORE_CONCURRENCY = 15;
// Emerging favorability scoring is gated to the top-N board candidates (the ones
// users actually see), bounded per run like score. Haiku on short quotes, so the
// cost is trivial (~well under $1/day); the cap + STAGE_TIME_BUDGET_MS are the
// real guards. Scores are keyed on the stable discovery_topics.id and upserted
// (never re-scored - the classify-runaway lesson, CLAUDE.md).
export const TOP_N_EMERGING = 12;
export const EMERGING_SCORE_LIMIT = 300;
export const EMERGING_SCORE_CONCURRENCY = 15;
// Wall-clock budget per stage. The per-stage cron has a 300s function limit;
// classify slows as the taxonomy grows (more issues → more mentions/episode),
// so a fixed LIMIT can overshoot 300s and 504 (no usage_log row). The pool
// stops pulling new work when this budget is hit, so the stage always finishes
// cleanly and processes as many items as fit. (2026-05-27 incident: 15
// episodes × 23 issues ran the full 300s serially and was killed mid-batch.)
export const STAGE_TIME_BUDGET_MS = 240_000;

export interface StageResult {
  ok: boolean;
  detail: Record<string, unknown>;
  durationMs: number;
}
export async function runStage(
  name: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<StageResult> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { ok: true, detail, durationMs: Date.now() - t0 };
  } catch (e: any) {
    return {
      ok: false,
      detail: { error: e?.message || String(e) },
      durationMs: Date.now() - t0,
    };
  }
}

// ─── Ingest ─────────────────────────────────────────────────────────────

export async function runIngest(): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const { data: channels, error } = await db
    .from("channels")
    .select("id, name, platform, platform_id, political_lean, reach")
    .eq("active", true)
    .order("reach", { ascending: false });
  if (error) throw new Error(`load channels: ${error.message}`);

  // Reach refresh: piggyback on the ingest's per-channel iteration. YT is
  // batched via getChannelDetailsBatch (up to 50 channels per API call) -
  // works perfectly, refreshes all YT subscriber counts daily.
  //
  // PODCAST REACH IS EDITORIAL - NOT REFRESHED. v0.6.57 attempted to refresh
  // podcasts via PodScan's /podcasts/{id} endpoint, but the only top-level
  // audience field PodScan exposes (`reach.audience_size`) returns numbers
  // wildly inconsistent with publicly-reported listener estimates: Joe Rogan
  // 14.5M (DB) vs 4.7M (PodScan), Mark Levin 7M (DB) vs 100 (PodScan).
  // The DB numbers match Edison-style weekly-listener estimates; PodScan's
  // appears to be its own internal-tracking metric (lower-bound only).
  // Auto-refreshing from PodScan would crash podcast reach 50–70% to less-
  // real numbers, so we skip podcasts entirely. See v0.6.58 CHANGELOG +
  // [[podcast-reach-editorial]] memory.
  //
  // Failures here are logged-and-skipped - ingest must not fail just because
  // YT's stats endpoint blipped.
  const ytChannelIds = (channels || [])
    .filter((c) => c.platform === "youtube")
    .map((c) => c.platform_id);
  let ytStats: Map<
    string,
    { title: string; subscriberCount: number; description: string }
  > = new Map();
  try {
    ytStats = await getChannelDetailsBatch(ytChannelIds);
  } catch (e) {
    console.error(`[ingest] YT batch stats failed: ${(e as Error)?.message}`);
  }
  let reachRefreshed = 0;
  let reachStale = 0;

  let totalFetched = 0;
  let totalNew = 0;
  let totalTranscripts = 0;
  let totalSkippedShort = 0;
  let totalSkippedDup = 0;
  let totalFailures = 0;

  for (const ch of channels || []) {
    // YouTube only - podcast reach is editorial (see top-of-function note).
    // Writing a 0/falsy value would zero out a valid reach (a transient
    // lookup miss shouldn't trash the stored stat), so we only update on
    // positive values.
    if (ch.platform === "youtube") {
      try {
        const stat = ytStats.get(ch.platform_id);
        if (stat && stat.subscriberCount > 0) {
          await db
            .from("channels")
            .update({
              reach: stat.subscriberCount,
              reach_updated_at: new Date().toISOString(),
            })
            .eq("id", ch.id);
          reachRefreshed++;
        } else {
          reachStale++;
        }
      } catch (e) {
        console.error(`[ingest] reach refresh failed for ${ch.name}: ${(e as Error)?.message}`);
        reachStale++;
      }
    }

    // Cross-platform dedup: skip episodes already ingested on a sibling channel
    // of the same show (same name, other platform). Loaded per channel so the
    // higher-reach copy (ingested first, reach-desc) wins and the re-post skips.
    const siblingKeys = await loadSiblingEpisodeKeys(db, ch.id, ch.name);
    if (ch.platform === "youtube") {
      const uploadsId = "UU" + ch.platform_id.slice(2);
      try {
        const videos = await getRecentUploads(uploadsId, INGEST_PER_CHANNEL * 2);
        totalFetched += videos.length;
        const longEnough = videos.filter(
          (v) => (v.durationSec ?? 0) >= MIN_DURATION_SEC,
        );
        totalSkippedShort += videos.length - longEnough.length;
        const slice = longEnough.slice(0, INGEST_PER_CHANNEL);
        for (const v of slice) {
          if (siblingKeys.has(dedupKey(v.title, v.publishedAt))) {
            totalSkippedDup++;
            continue;
          }
          const { error: e, data } = await db
            .from("episodes")
            .upsert(
              {
                channel_id: ch.id,
                title: v.title,
                published_at: v.publishedAt,
                source_url: v.url,
                duration_sec: v.durationSec ?? null,
              },
              { onConflict: "channel_id,source_url", ignoreDuplicates: false },
            )
            .select();
          if (e) totalFailures++;
          else if (data && data.length > 0) totalNew++;
        }
      } catch {
        totalFailures++;
      }
    } else if (ch.platform === "podcast") {
      try {
        const eps = await getPodcastEpisodes(ch.platform_id, INGEST_PER_CHANNEL);
        totalFetched += eps.length;
        const longEnough = eps.filter((ep) => {
          const dur =
            ep.episode_duration || (ep as any).duration || (ep as any).duration_seconds || 0;
          return Number(dur) >= MIN_DURATION_SEC;
        });
        totalSkippedShort += eps.length - longEnough.length;
        const slice = longEnough.slice(0, INGEST_PER_CHANNEL);
        for (const ep of slice) {
          const url =
            ep.episode_url ||
            ep.episode_permalink ||
            (ep as any).url ||
            (ep as any).link ||
            ep.episode_audio_url ||
            (ep as any).audio_url;
          const title = ep.episode_title || (ep as any).title || (ep as any).name || "(untitled)";
          const published =
            ep.posted_at ||
            (ep as any).published_at ||
            (ep as any).publish_date ||
            ep.created_at;
          const transcriptText =
            ep.episode_transcript || (ep as any).transcript || (ep as any).text;
          const duration = ep.episode_duration || (ep as any).duration;
          if (!url || !published) {
            totalFailures++;
            continue;
          }
          if (siblingKeys.has(dedupKey(String(title), String(published)))) {
            totalSkippedDup++;
            continue;
          }
          const hasTranscript = !!(transcriptText && String(transcriptText).trim().length > 0);
          const { error: e, data } = await db
            .from("episodes")
            .upsert(
              {
                channel_id: ch.id,
                title: String(title).slice(0, 500),
                published_at: published,
                source_url: url,
                duration_sec: typeof duration === "number" ? Math.round(duration) : null,
              },
              { onConflict: "channel_id,source_url", ignoreDuplicates: false },
            )
            .select();
          if (e) {
            totalFailures++;
            continue;
          }
          const epRow = data?.[0];
          if (!epRow) continue;
          totalNew++;
          if (hasTranscript) {
            const { error: txErr } = await db.from("transcripts").upsert(
              {
                episode_id: epRow.id,
                text: String(transcriptText),
                provider: "podscan",
              },
              { onConflict: "episode_id", ignoreDuplicates: false },
            );
            if (!txErr) {
              totalTranscripts++;
              await db
                .from("episodes")
                .update({ transcript_status: "fetched" })
                .eq("id", epRow.id);
            }
          }
        }
      } catch {
        totalFailures++;
      }
    }
  }

  return {
    channelsProcessed: channels?.length || 0,
    fetched: totalFetched,
    newEpisodes: totalNew,
    transcriptsInline: totalTranscripts,
    skippedShort: totalSkippedShort,
    skippedCrossPlatformDup: totalSkippedDup,
    failures: totalFailures,
    reachRefreshed,
    reachStale,
  };
}

// ─── Transcribe ─────────────────────────────────────────────────────────

export async function runTranscribe(): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const { data: pending, error: pendingErr } = await db
    .from("episodes")
    .select("id, source_url, channel_id, transcript_attempts")
    .eq("transcript_status", "pending")
    // Oldest-pending-first: YouTube auto-captions take hours-to-a-day to
    // generate for fresh uploads. If we attack newest-first we burn through
    // TRANSCRIBE_LIMIT on episodes whose captions don't exist yet, mark
    // them failed, and never retry. Oldest-first lets captions catch up
    // and dramatically improves success rate. Cost: ~24h latency between
    // an episode being published and being scored, which is fine for a
    // trailing 7-day Index.
    .order("published_at", { ascending: true })
    .limit(TRANSCRIBE_LIMIT);

  if (pendingErr) throw new Error(`load pending episodes: ${pendingErr.message}`);

  // Resolve channel platform via a direct id->platform map rather than a
  // PostgREST embed. The embedded `channel:channels!fk(platform)` did not
  // expose `.platform` reliably in the Vercel runtime, so every YouTube
  // episode fell through the `!== "youtube"` guard and was marked failed
  // without ever calling Supadata (2026-05-24 incident). A plain map is
  // unambiguous and embed-shape-proof.
  const { data: channels, error: chErr } = await db
    .from("channels")
    .select("id, platform");
  if (chErr) throw new Error(`load channels: ${chErr.message}`);
  const platformById = new Map<string, string>(
    (channels || []).map((c: any) => [c.id, c.platform]),
  );

  let ok = 0;
  let failed = 0;
  let retrying = 0;
  const stageStart = Date.now();

  // Transient failure: bump the attempt counter and leave the episode `pending`
  // so the next run retries it - unless it has now exhausted its attempts, in
  // which case give up and mark `failed`.
  const handleTransient = async (row: any, reason: string) => {
    const attempts = (row.transcript_attempts ?? 0) + 1;
    if (attempts >= MAX_TRANSCRIPT_ATTEMPTS) {
      await db
        .from("episodes")
        .update({ transcript_status: "failed", transcript_attempts: attempts })
        .eq("id", row.id);
      failed++;
      console.error(`[transcribe] ${row.id}: giving up after ${attempts} attempts (${reason})`);
    } else {
      await db
        .from("episodes")
        .update({ transcript_attempts: attempts })
        .eq("id", row.id);
      retrying++;
    }
  };

  // Fetch transcripts through a bounded-concurrency pool (was serial). Each
  // Supadata call is multi-second, so concurrency 8 stays ~2 req/s - under the
  // 10/s limit. Pool stops pulling new rows at the time budget so the cron
  // finishes under 300s. Counters are safe to mutate (single-threaded).
  await mapPool(
    (pending || []) as any[],
    TRANSCRIBE_CONCURRENCY,
    async (row) => {
      const platform = platformById.get(row.channel_id);
      if (platform !== "youtube") {
        // Podcast still pending after ingest means PodScan didn't have the
        // transcript yet - mark failed; retried on subsequent ingest runs.
        await db
          .from("episodes")
          .update({ transcript_status: "failed" })
          .eq("id", row.id);
        failed++;
        return;
      }
      try {
        const u = new URL(row.source_url);
        const videoId =
          u.hostname.includes("youtu.be")
            ? u.pathname.replace(/^\//, "")
            : u.searchParams.get("v");
        if (!videoId) {
          // Malformed URL is terminal - no amount of retrying fixes it.
          await db.from("episodes").update({ transcript_status: "failed" }).eq("id", row.id);
          failed++;
          return;
        }
        const result = await getVideoTranscript(videoId);
        if (!result.ok) {
          if (result.retriable) {
            await handleTransient(row, result.reason);
          } else {
            // No captions / bad video → terminal, stop here.
            await db.from("episodes").update({ transcript_status: "failed" }).eq("id", row.id);
            failed++;
          }
          return;
        }
        const { error: txErr } = await db.from("transcripts").upsert(
          { episode_id: row.id, text: result.text, provider: "youtube_captions" },
          { onConflict: "episode_id", ignoreDuplicates: false },
        );
        if (txErr) {
          // DB write hiccup is transient - retry rather than strand the episode.
          console.error(`[transcribe] upsert failed for ${row.id}: ${txErr.message}`);
          await handleTransient(row, `upsert: ${txErr.message}`);
          return;
        }
        await db
          .from("episodes")
          .update({ transcript_status: "fetched" })
          .eq("id", row.id);
        ok++;
      } catch (e: any) {
        // Unexpected exception (network, etc.) - treat as transient/retriable.
        console.error(`[transcribe] ${row.id}: ${e?.message || String(e)}`);
        await handleTransient(row, e?.message || String(e));
      }
    },
    stageStart + STAGE_TIME_BUDGET_MS,
  );

  return { processed: (pending || []).length, succeeded: ok, failed, retrying };
}

// ─── Classify ───────────────────────────────────────────────────────────

export async function runClassify(): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const stageStart = Date.now();
  const { data: issues } = await db
    .from("issues")
    .select("slug, name, definition")
    .eq("active", true);
  const issuesTyped = (issues || []) as IssueDef[];

  // Find pending episodes EPISODE-FIRST: query the episodes table for ones that
  // are transcribed but not yet classified, then load each transcript's text on
  // demand inside the loop. The previous approach embedded the full `text` of
  // EVERY transcript (≈80MB across pages) just to filter for the pending tail -
  // and worse, selected/ordered by a non-existent `transcripts.id` column, so
  // the query 400'd every run and the swallowed error surfaced as a silent
  // pendingFound=0 (cron classify stalled from v0.6.47 until this fix; the CLI
  // already went episode-first in v0.6.48). `classify_status` is the queue key:
  // 'pending' until processed, then 'processed' regardless of mention count so
  // 0-mention episodes aren't reprocessed every run (head-of-line fix, v0.6.29).
  //
  // Paginate with a stable order, terminate ONLY on an empty page (a short page
  // is routine under the response-size cap), and CHECK the error - never let a
  // failed query masquerade as an empty queue again.
  const pageSize = 1000;
  const maxPages = 500;
  const pendingEpisodes: any[] = [];
  for (let from = 0, pages = 0; pages < maxPages; pages++, from += pageSize) {
    const { data, error } = await db
      .from("episodes")
      .select(
        `id, title, published_at,
         channel:channels!episodes_channel_id_fkey ( name, political_lean )`,
      )
      .eq("classify_status", "pending")
      .eq("transcript_status", "fetched")
      // Newest first (recent backlog has the most editorial value); `id` is the
      // unique tiebreaker so same-second publishes can't re-cross page bounds.
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error)
      throw new Error(`runClassify: load pending episodes: ${error.message}`);
    if (!data || data.length === 0) break;
    pendingEpisodes.push(...data);
  }

  let totalMentions = 0;
  let totalOffTopics = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let processed = 0;
  let failed = 0;

  // Classify up to CLASSIFY_LIMIT episodes through a bounded-concurrency pool
  // (was one-at-a-time). The pool stops pulling new episodes once the stage
  // time budget is hit, so the run still finishes under the 300s function
  // limit. Shared counters are safe to mutate - JS is single-threaded.
  const toClassify = pendingEpisodes.slice(0, CLASSIFY_LIMIT);
  const { completed } = await mapPool(
    toClassify,
    CLASSIFY_CONCURRENCY,
    async (ep) => {
      // Load just this episode's transcript text on demand - keeps per-item
      // payload small (one transcript, not all of them).
      const { data: tRow, error: tErr } = await db
        .from("transcripts")
        .select("text")
        .eq("episode_id", ep.id)
        .maybeSingle();
      if (tErr || !tRow?.text) {
        failed++;
        return;
      }

      try {
        const result = await classifyTranscript({
          transcript: tRow.text,
          channelName: ep.channel?.name || "(unknown)",
          politicalLean: ep.channel?.political_lean || "M",
          episodeTitle: ep.title || "",
          publishedAt: ep.published_at || new Date().toISOString(),
          issues: issuesTyped,
        });
        inputTokens += result.inputTokens || 0;
        outputTokens += result.outputTokens || 0;
        if (result.mentions.length > 0) {
          const rows = result.mentions.map((m) => ({
            episode_id: ep.id,
            issue_slug: m.issue_slug,
            supporting_quote: m.supporting_quote,
          }));
          const { error: insErr } = await db.from("classifications").insert(rows);
          // Leave classify_status pending on insert failure so it retries;
          // don't mark processed or we'd lose these mentions permanently.
          if (insErr) {
            failed++;
            return;
          }
          totalMentions += result.mentions.length;
        }
        // Emerging-issue discovery: store off-taxonomy political topics.
        // Secondary to classification - a failure here must not fail the ep.
        if (result.offTopics.length > 0) {
          const topicRows = result.offTopics.map((o) => ({
            episode_id: ep.id,
            label: o.topic,
            quote: o.supporting_quote,
          }));
          const { error: topicErr } = await db.from("discovery_topics").insert(topicRows);
          if (!topicErr) totalOffTopics += result.offTopics.length;
        }
        // Mark processed regardless of mention count - the fix for the
        // reprocessing loop. 0-mention (off-taxonomy) episodes are recorded
        // as done and never re-sent to the model.
        await db
          .from("episodes")
          .update({ classify_status: "processed" })
          .eq("id", ep.id);
        processed++;
      } catch {
        failed++;
      }
    },
    stageStart + STAGE_TIME_BUDGET_MS,
  );
  const timedOut = completed < toClassify.length;

  const estCost = estimateCostUsd(MODEL_CLASSIFY, { inputTokens, outputTokens });
  return {
    pendingFound: pendingEpisodes.length,
    processed,
    stoppedAtTimeBudget: timedOut,
    mentions: totalMentions,
    offTopics: totalOffTopics,
    failed,
    inputTokens,
    outputTokens,
    approxCostUsd: Number(estCost.toFixed(4)),
  };
}

// ─── Score ──────────────────────────────────────────────────────────────

export async function runScore(): Promise<Record<string, unknown>> {
  const db = createServiceClient();

  // Paginated classifications + existing scores
  const classifications: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await db
      .from("classifications")
      .select(
        `id, supporting_quote,
         issue:issues!classifications_issue_slug_fkey (
           name, definition, left_position, right_position
         ),
         episode:episodes!classifications_episode_id_fkey (
           channel:channels!episodes_channel_id_fkey (
             name, political_lean
           )
         )`,
      )
      // Stable PK order - same gotcha as runClassify above (v0.6.47).
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    classifications.push(...data);
    // Empty-page-only termination - short pages on deep joins are routine
    // on Vercel's edge→Supabase route. See runClassify above (v0.6.51).
  }
  const scored: { classification_id: string }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await db
      .from("sentiment_scores")
      .select("classification_id")
      // UNIQUE(classification_id) so it's a stable pagination key.
      .order("classification_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    scored.push(...(data as any));
    // Empty-page-only termination - see runClassify above (v0.6.51). This
    // query is narrow (just classification_id) so a short page is less
    // likely, but the response-size threshold isn't worth gambling on.
  }
  const scoredSet = new Set(scored.map((s) => s.classification_id));
  const pending = classifications.filter((c) => !scoredSet.has(c.id));

  let ok = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  // Score up to SCORE_LIMIT mentions through a bounded-concurrency pool (was
  // one-at-a-time). Haiku is fast, so even a large batch finishes well under
  // the 300s limit; counters are safe to mutate (single-threaded).
  await mapPool(pending.slice(0, SCORE_LIMIT), SCORE_CONCURRENCY, async (c) => {
    try {
      const result = await scoreClassification({
        quote: c.supporting_quote,
        channelName: c.episode?.channel?.name || "(unknown)",
        politicalLean: c.episode?.channel?.political_lean || "M",
        issueName: c.issue?.name || "",
        issueDefinition: c.issue?.definition || "",
        leftPosition: c.issue?.left_position || "",
        rightPosition: c.issue?.right_position || "",
      });
      inputTokens += result.inputTokens || 0;
      outputTokens += result.outputTokens || 0;
      const { error: insErr } = await db.from("sentiment_scores").upsert(
        {
          classification_id: c.id,
          sentiment: result.sentiment,
          intensity: result.intensity,
          supporting_quote: c.supporting_quote,
          model: MODEL_SCORE,
          model_version: "v0",
        },
        // Idempotent under UNIQUE(classification_id): overlapping score runs
        // (cron + CLI) no-op instead of creating duplicate scores.
        { onConflict: "classification_id", ignoreDuplicates: true },
      );
      if (insErr) {
        console.error(
          `[score] insert failed for classification ${c.id}: ${insErr.message}`,
        );
        failed++;
      } else {
        ok++;
      }
    } catch (e: any) {
      const errClass = e?.constructor?.name || "Error";
      const errMsg = e?.message || String(e);
      console.error(`[score] ${errClass} for classification ${c.id}: ${errMsg}`);
      failed++;
    }
  });

  const estCost = estimateCostUsd(MODEL_SCORE, { inputTokens, outputTokens });
  return {
    pendingFound: pending.length,
    processed: ok + failed,
    succeeded: ok,
    failed,
    inputTokens,
    outputTokens,
    approxCostUsd: Number(estCost.toFixed(4)),
  };
}

// ─── Score (emerging favorability) ────────────────────────────────────────
//
// Favorability of the conversation on the prominent /emerging events. Mirrors
// runScore: bounded-concurrency pool, STAGE_TIME_BUDGET_MS wall clock, hard
// per-run cap, idempotent upsert. Gated to the top-N board candidates and keyed
// on the stable discovery_topics.id (candidate ids churn every discover run).

export async function runScoreEmerging(): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const stageStart = Date.now();

  // Reuse the public board ranking (volume x momentum) so we score exactly the
  // prominent events users see, not every micro-cluster.
  const board = await getEmergingBoard();
  const top = board.all.slice(0, TOP_N_EMERGING);
  if (top.length === 0) {
    return {
      topCandidates: 0, pendingFound: 0, processed: 0, succeeded: 0, failed: 0,
      inputTokens: 0, outputTokens: 0, approxCostUsd: 0,
    };
  }
  const topIds = top.map((c) => c.id);
  const summaryById = new Map(top.map((c) => [c.id, c.summary || ""]));

  // Member topics of the top-N candidates (stable-id paginated; empty-page-only
  // termination - the deep-join short-page gotcha, v0.6.51).
  interface MemberRow {
    id: string;
    label: string;
    quote: string | null;
    candidate_id: string;
    channel_name: string;
    political_lean: "L" | "M" | "R";
  }
  const members: MemberRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("discovery_topics")
      .select(
        `id, label, quote, candidate_id,
         episode:episodes!discovery_topics_episode_id_fkey (
           channel:channels!episodes_channel_id_fkey ( name, political_lean )
         )`,
      )
      .in("candidate_id", topIds)
      .not("quote", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`runScoreEmerging members: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const ch = r.episode?.channel;
      if (!ch) continue;
      members.push({
        id: r.id,
        label: r.label,
        quote: r.quote,
        candidate_id: r.candidate_id,
        channel_name: ch.name,
        political_lean: (ch.political_lean as MemberRow["political_lean"]) || "M",
      });
    }
    if (data.length < pageSize) break;
  }

  // Already-scored topic ids. The table only ever holds top-N mentions, so it
  // stays small; load all ids into a Set (mirrors runScore's scored lookup).
  const scoredSet = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const { data } = await db
      .from("discovery_topic_scores")
      .select("discovery_topic_id")
      .order("discovery_topic_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    for (const s of data as any[]) scoredSet.add(s.discovery_topic_id);
    if (data.length < pageSize) break;
  }

  const pending = members.filter((m) => m.quote && !scoredSet.has(m.id));
  const batch = pending.slice(0, EMERGING_SCORE_LIMIT);

  let ok = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const { completed } = await mapPool(
    batch,
    EMERGING_SCORE_CONCURRENCY,
    async (m) => {
      try {
        const result = await scoreEmergingMention({
          quote: m.quote as string,
          channelName: m.channel_name,
          politicalLean: m.political_lean,
          subject: m.label,
          subjectContext: summaryById.get(m.candidate_id) || undefined,
        });
        inputTokens += result.inputTokens || 0;
        outputTokens += result.outputTokens || 0;
        const { error: insErr } = await db.from("discovery_topic_scores").upsert(
          {
            discovery_topic_id: m.id,
            favorability: result.favorability,
            intensity: result.intensity,
            model: MODEL_SCORE,
            model_version: EMERGING_SCORE_PROMPT_VERSION,
          },
          // Idempotent under UNIQUE(discovery_topic_id): overlapping runs no-op.
          { onConflict: "discovery_topic_id", ignoreDuplicates: true },
        );
        if (insErr) {
          console.error(`[score-emerging] insert failed for topic ${m.id}: ${insErr.message}`);
          failed++;
        } else {
          ok++;
        }
      } catch (e: any) {
        console.error(
          `[score-emerging] ${e?.constructor?.name || "Error"} for topic ${m.id}: ${e?.message || e}`,
        );
        failed++;
      }
    },
    stageStart + STAGE_TIME_BUDGET_MS,
  );

  const estCost = estimateCostUsd(MODEL_SCORE, { inputTokens, outputTokens });
  return {
    topCandidates: top.length,
    pendingFound: pending.length,
    processed: ok + failed,
    succeeded: ok,
    failed,
    stoppedAtTimeBudget: completed < batch.length,
    inputTokens,
    outputTokens,
    approxCostUsd: Number(estCost.toFixed(4)),
  };
}
