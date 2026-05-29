/**
 * Pipeline stages (ingest → transcribe → classify → score) extracted from the
 * cron route so each can run as its OWN Vercel cron with a full 300s budget.
 * The combined run hit the 300s timeout once classify started doing real work
 * (v0.6.29), which starved `score` and skipped the usage_log write (504s,
 * 2026-05-26). Each stage reads inputs from the DB and writes outputs to the DB
 * and never calls another stage (see ARCHITECTURE.md) — which is exactly what
 * lets them split cleanly.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db";
import { getRecentUploads, getVideoTranscript } from "@/lib/youtube";
import { getPodcastEpisodes } from "@/lib/podscan";
import { classifyTranscript, type IssueDef } from "@/modules/classify";
import { scoreClassification } from "@/modules/score";
import { MODEL_SCORE } from "@/lib/anthropic";
import { dedupKey, loadSiblingEpisodeKeys } from "@/lib/dedup";

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

export const MIN_DURATION_SEC = 180;
export const INGEST_PER_CHANNEL = 3;
export const TRANSCRIBE_LIMIT = 40;
export const CLASSIFY_LIMIT = 15;
export const SCORE_LIMIT = 80;
// Wall-clock budget per stage. The per-stage cron has a 300s function limit;
// classify slows as the taxonomy grows (more issues → more mentions/episode),
// so a fixed CLASSIFY_LIMIT can overshoot 300s and 504 (no usage_log row).
// The loop stops when this budget is hit, so it always completes cleanly and
// processes as many episodes as fit. (2026-05-27 incident: 15 episodes × 23
// issues ran the full 300s and was killed mid-batch.)
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

  let totalFetched = 0;
  let totalNew = 0;
  let totalTranscripts = 0;
  let totalSkippedShort = 0;
  let totalSkippedDup = 0;
  let totalFailures = 0;

  for (const ch of channels || []) {
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
  };
}

// ─── Transcribe ─────────────────────────────────────────────────────────

export async function runTranscribe(): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const { data: pending, error: pendingErr } = await db
    .from("episodes")
    .select("id, source_url, channel_id")
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

  for (const row of (pending || []) as any[]) {
    const platform = platformById.get(row.channel_id);
    if (platform !== "youtube") {
      // Podcast still pending after ingest means PodScan didn't have the
      // transcript yet — mark failed; it'll be retried on subsequent ingest
      // runs if PodScan catches up.
      await db
        .from("episodes")
        .update({ transcript_status: "failed" })
        .eq("id", row.id);
      failed++;
      continue;
    }
    try {
      const u = new URL(row.source_url);
      const videoId =
        u.hostname.includes("youtu.be")
          ? u.pathname.replace(/^\//, "")
          : u.searchParams.get("v");
      if (!videoId) {
        await db.from("episodes").update({ transcript_status: "failed" }).eq("id", row.id);
        failed++;
        continue;
      }
      const transcript = await getVideoTranscript(videoId);
      if (!transcript || transcript.trim().length === 0) {
        await db.from("episodes").update({ transcript_status: "failed" }).eq("id", row.id);
        failed++;
        continue;
      }
      const { error: txErr } = await db.from("transcripts").upsert(
        { episode_id: row.id, text: transcript, provider: "youtube_captions" },
        { onConflict: "episode_id", ignoreDuplicates: false },
      );
      if (txErr) {
        console.error(`[transcribe] upsert failed for ${row.id}: ${txErr.message}`);
        failed++;
        continue;
      }
      await db
        .from("episodes")
        .update({ transcript_status: "fetched" })
        .eq("id", row.id);
      ok++;
    } catch (e: any) {
      // Don't swallow silently — a missing env var or a Supadata outage should
      // be visible in logs, not hidden behind a bare catch. (2026-05-24)
      console.error(`[transcribe] ${row.id}: ${e?.message || String(e)}`);
      failed++;
    }
  }

  return { processed: (pending || []).length, succeeded: ok, failed };
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

  // Pull transcript ids + content (paginate to clear 1000-row default cap).
  // `classify_status` on the episode is the queue key: pending = not yet run
  // through classify. Crucially this is independent of whether the episode
  // produced mentions — a 0-mention episode is marked 'processed' below so it
  // is NOT reprocessed every run (the head-of-line-blocking bug that burned
  // ~$1/run on the same off-taxonomy episodes; see v0.6.29).
  const transcripts: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await db
      .from("transcripts")
      .select(
        `id, episode_id, text,
         episode:episodes!transcripts_episode_id_fkey (
           title, published_at, classify_status,
           channel:channels!episodes_channel_id_fkey (
             name, political_lean
           )
         )`,
      )
      // Stable PK order is REQUIRED for .range() once the table grows past 1000
      // rows — without it PostgREST/Postgres can return inconsistent pages and
      // a single .range() call may miss the un-processed tail entirely. (v0.6.47
      // — 08:30 and 12:30 classify runs both reported pendingFound=0 while 564
      // were actually pending.)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    transcripts.push(...data);
    // Terminate ONLY on an empty page. A short page (length < pageSize but
    // > 0) does NOT mean we're done — Vercel's edge→Supabase route hits a
    // response-size cap before the row cap on this deep-join query (each
    // row carries the full transcript text), so the first page often returns
    // truncated. The old `length < pageSize` early-out interpreted that as
    // end-of-data, leaving `transcripts` populated only with the oldest
    // already-processed rows → JS filter to pending returned [] → silent
    // `pendingFound=0` on every run after the table crossed the response
    // threshold. (v0.6.51 — same shape as v0.6.3 fix for the read-side
    // aggregate path; v0.6.47 added ORDER BY but kept the early-out.)
  }
  const pending = transcripts.filter(
    (t) => t.episode?.classify_status !== "processed",
  );

  let totalMentions = 0;
  let totalOffTopics = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let processed = 0;
  let failed = 0;
  let timedOut = false;

  for (const t of pending.slice(0, CLASSIFY_LIMIT)) {
    // Stop before the 300s function limit so the stage always finishes cleanly
    // (writes its usage_log row) rather than being killed mid-batch.
    if (Date.now() - stageStart > STAGE_TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }
    try {
      const result = await classifyTranscript({
        transcript: t.text,
        channelName: t.episode?.channel?.name || "(unknown)",
        politicalLean: t.episode?.channel?.political_lean || "M",
        episodeTitle: t.episode?.title || "",
        publishedAt: t.episode?.published_at || new Date().toISOString(),
        issues: issuesTyped,
      });
      inputTokens += result.inputTokens || 0;
      outputTokens += result.outputTokens || 0;
      if (result.mentions.length > 0) {
        const rows = result.mentions.map((m) => ({
          episode_id: t.episode_id,
          issue_slug: m.issue_slug,
          supporting_quote: m.supporting_quote,
        }));
        const { error: insErr } = await db.from("classifications").insert(rows);
        // Leave classify_status pending on insert failure so it retries; don't
        // mark processed or we'd lose these mentions permanently.
        if (insErr) {
          failed++;
          continue;
        }
        totalMentions += result.mentions.length;
      }
      // Emerging-issue discovery: store off-taxonomy political topics. Secondary
      // to classification — a failure here must not fail the episode.
      if (result.offTopics.length > 0) {
        const topicRows = result.offTopics.map((o) => ({
          episode_id: t.episode_id,
          label: o.topic,
          quote: o.supporting_quote,
        }));
        const { error: topicErr } = await db.from("discovery_topics").insert(topicRows);
        if (!topicErr) totalOffTopics += result.offTopics.length;
      }
      // Mark processed regardless of mention count — this is the fix for the
      // reprocessing loop. 0-mention (off-taxonomy) episodes are recorded as
      // done and never re-sent to the model.
      await db
        .from("episodes")
        .update({ classify_status: "processed" })
        .eq("id", t.episode_id);
      processed++;
    } catch {
      failed++;
    }
  }

  const estCost = (inputTokens * 3) / 1_000_000 + (outputTokens * 15) / 1_000_000;
  return {
    pendingFound: pending.length,
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
      // Stable PK order — same gotcha as runClassify above (v0.6.47).
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    classifications.push(...data);
    // Empty-page-only termination — short pages on deep joins are routine
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
    // Empty-page-only termination — see runClassify above (v0.6.51). This
    // query is narrow (just classification_id) so a short page is less
    // likely, but the response-size threshold isn't worth gambling on.
  }
  const scoredSet = new Set(scored.map((s) => s.classification_id));
  const pending = classifications.filter((c) => !scoredSet.has(c.id));

  let ok = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const c of pending.slice(0, SCORE_LIMIT)) {
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
  }

  const estCost = (inputTokens * 1) / 1_000_000 + (outputTokens * 5) / 1_000_000;
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
