/**
 * Vercel Cron endpoint — runs the full Soapbox pipeline daily.
 *
 * Stages, each with conservative batch limits to fit Vercel Pro's 300s
 * function timeout:
 *   1. ingest    — pull recent episodes from YT + PodScan for all channels
 *   2. transcribe — fetch YT auto-captions for pending YT episodes
 *   3. classify   — extract issue mentions from new transcripts (Sonnet 4.6)
 *   4. score      — sentiment + intensity per classification (Haiku 4.5)
 *
 * Scheduling: see /vercel.json — currently runs daily at 10:00 UTC (6 AM ET).
 *
 * Auth: Vercel Cron auto-attaches `Authorization: Bearer ${CRON_SECRET}` to
 * the request. Set CRON_SECRET in Vercel → Project Settings → Environment
 * Variables. Any value works; treat it like a secret.
 *
 * Manual test:
 *   curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
 *     https://soapbox.media/api/cron/pipeline
 *
 * NOTE on Vercel plan:
 *   - Hobby plan caps function runtime at 60s — too tight for classify.
 *     If on Hobby, split into separate cron jobs per stage or upgrade to Pro.
 *   - Pro plan supports up to 300s (5min) default; we use 300 explicitly.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db";
import { getRecentUploads, getVideoTranscript } from "@/lib/youtube";
import { getPodcastEpisodes } from "@/lib/podscan";
import { classifyTranscript, type IssueDef } from "@/modules/classify";
import { scoreClassification } from "@/modules/score";
import { MODEL_SCORE } from "@/lib/anthropic";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Conservative batch limits per cron invocation
const MIN_DURATION_SEC = 180;
const INGEST_PER_CHANNEL = 3;
const TRANSCRIBE_LIMIT = 10;
const CLASSIFY_LIMIT = 2;
const SCORE_LIMIT = 30;

interface StageResult {
  ok: boolean;
  detail: Record<string, unknown>;
  durationMs: number;
}

interface PipelineSummary {
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  stages: {
    ingest: StageResult;
    transcribe: StageResult;
    classify: StageResult;
    score: StageResult;
  };
}

export async function GET(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  const ingest = await runStage("ingest", runIngest);
  const transcribe = await runStage("transcribe", runTranscribe);
  const classify = await runStage("classify", runClassify);
  const score = await runStage("score", runScore);

  const finishedAt = new Date().toISOString();
  const summary: PipelineSummary = {
    startedAt,
    finishedAt,
    totalDurationMs: Date.now() - startTime,
    stages: { ingest, transcribe, classify, score },
  };

  return NextResponse.json(summary);
}

async function runStage(
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

async function runIngest(): Promise<Record<string, unknown>> {
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
  let totalFailures = 0;

  for (const ch of channels || []) {
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
    failures: totalFailures,
  };
}

// ─── Transcribe ─────────────────────────────────────────────────────────

async function runTranscribe(): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const { data: pending } = await db
    .from("episodes")
    .select(
      `id, source_url,
       channel:channels!episodes_channel_id_fkey ( platform )`,
    )
    .eq("transcript_status", "pending")
    .order("published_at", { ascending: false })
    .limit(TRANSCRIBE_LIMIT);

  let ok = 0;
  let failed = 0;

  for (const row of (pending || []) as any[]) {
    const platform = row.channel?.platform;
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
        failed++;
        continue;
      }
      await db
        .from("episodes")
        .update({ transcript_status: "fetched" })
        .eq("id", row.id);
      ok++;
    } catch {
      failed++;
    }
  }

  return { processed: (pending || []).length, succeeded: ok, failed };
}

// ─── Classify ───────────────────────────────────────────────────────────

async function runClassify(): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const { data: issues } = await db
    .from("issues")
    .select("slug, name, definition")
    .eq("active", true);
  const issuesTyped = (issues || []) as IssueDef[];

  // Pull transcript ids + content (paginate to clear 1000-row default cap)
  const transcripts: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await db
      .from("transcripts")
      .select(
        `episode_id, text,
         episode:episodes!transcripts_episode_id_fkey (
           title, published_at,
           channel:channels!episodes_channel_id_fkey (
             name, political_lean
           )
         )`,
      )
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    transcripts.push(...data);
    if (data.length < pageSize) break;
  }
  const classified: { episode_id: string }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await db
      .from("classifications")
      .select("episode_id")
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    classified.push(...(data as any));
    if (data.length < pageSize) break;
  }
  const classifiedSet = new Set(classified.map((c) => c.episode_id));
  const pending = transcripts.filter((t) => !classifiedSet.has(t.episode_id));

  let totalMentions = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let processed = 0;
  let failed = 0;

  for (const t of pending.slice(0, CLASSIFY_LIMIT)) {
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
        if (insErr) failed++;
        else totalMentions += result.mentions.length;
      }
      processed++;
    } catch {
      failed++;
    }
  }

  const estCost = (inputTokens * 3) / 1_000_000 + (outputTokens * 15) / 1_000_000;
  return {
    pendingFound: pending.length,
    processed,
    mentions: totalMentions,
    failed,
    inputTokens,
    outputTokens,
    approxCostUsd: Number(estCost.toFixed(4)),
  };
}

// ─── Score ──────────────────────────────────────────────────────────────

async function runScore(): Promise<Record<string, unknown>> {
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
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    classifications.push(...data);
    if (data.length < pageSize) break;
  }
  const scored: { classification_id: string }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await db
      .from("sentiment_scores")
      .select("classification_id")
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    scored.push(...(data as any));
    if (data.length < pageSize) break;
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
      const { error: insErr } = await db.from("sentiment_scores").insert({
        classification_id: c.id,
        sentiment: result.sentiment,
        intensity: result.intensity,
        supporting_quote: c.supporting_quote,
        model: MODEL_SCORE,
        model_version: "v0",
      });
      if (insErr) failed++;
      else ok++;
    } catch {
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
