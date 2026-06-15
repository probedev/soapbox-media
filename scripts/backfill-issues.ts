/**
 * One-time backfill for newly-activated issues (taxonomy v2 gap issues).
 *
 * Re-classifies recent transcripts against the FULL active taxonomy but inserts
 * ONLY mentions for the new gap issues — so the existing 16 issues'
 * classifications are never duplicated. Gives the new issues historical data
 * instead of starting empty. Idempotent: skips episodes that already have a
 * classification in any new slug, so it's safe to re-run / resume.
 *
 * Run:  npm run backfill:issues -- <window-days> [limit]    (default 30 days)
 * Then: npm run score -- <n>   (to score the new classifications)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { classifyTranscript, type IssueDef } from "@/modules/classify";
import { mapPool } from "@/lib/concurrency";
import { MODEL_CLASSIFY } from "@/lib/anthropic";
import { estimateCostUsd } from "@/lib/pricing";
import { recordScriptRun } from "@/lib/usage";

// Match production classify (CLASSIFY_CONCURRENCY in src/lib/pipeline.ts) - a
// known-safe rate against the Anthropic limits. Serial would take ~14h at the
// current panel size; concurrency 10 brings the full 30d run to ~1.5h.
const BACKFILL_CONCURRENCY = 10;

// Slugs whose mentions get inserted. Defaults to the 2026-06-12 taxonomy-
// expansion issues, but override per-run via BACKFILL_SLUGS (comma-separated)
// to backfill any newly-promoted issue. The classifier always runs against the
// FULL active taxonomy; only mentions in these slugs are written. (Crypto was a
// broadening of the existing ai-tech issue, not a new slug, so it was excluded
// from the default - a widened issue can't be backfilled without duplicating
// its existing mentions.)
const NEW_SLUGS = new Set(
  (process.env.BACKFILL_SLUGS ?? "trade-tariffs,housing,govt-spending,public-health,veterans")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Optional cost control. When BACKFILL_KEYWORDS is set (comma-separated), only
// episodes whose transcript contains at least one keyword (case-insensitive)
// are classified. For a narrow, vocabulary-bound issue this catches ~all real
// mentions while skipping the (expensive) classify call on unrelated episodes.
// NOTE: a broad ILIKE over every transcript can exceed the PostgREST statement
// timeout on a large panel. In that case precompute the matching episode_ids
// server-side (longer-timeout SQL path) into a one-column table and point
// BACKFILL_TARGET_TABLE at it instead - the script just reads the id list.
const KEYWORDS = (process.env.BACKFILL_KEYWORDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// A table with an `episode_id` column that enumerates the only episodes to
// classify. Takes precedence over BACKFILL_KEYWORDS. Use for large panels
// where the inline keyword scan times out.
const TARGET_TABLE = process.env.BACKFILL_TARGET_TABLE?.trim();

async function main() {
  const windowDays = parseInt(process.argv[2] || "30", 10);
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity;
  const startedAt = Date.now();
  const db = createServiceClient();

  const { data: issues } = await db
    .from("issues")
    .select("slug, name, definition")
    .eq("active", true);
  const issuesTyped = (issues || []) as IssueDef[];
  console.log(`\nBackfill new issues — last ${windowDays}d, classifying against ${issuesTyped.length} active issues, inserting only: ${[...NEW_SLUGS].join(", ")}\n`);

  // Episodes already backfilled (have a classification in a new slug) → skip.
  const done = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("classifications")
      .select("episode_id, issue_slug")
      .in("issue_slug", [...NEW_SLUGS])
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data as { episode_id: string }[]) done.add(r.episode_id);
    if (data.length < 1000) break;
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);
  const sinceIso = since.toISOString();

  // 1. Episodes in window (lightweight: no transcript text). Filter the window
  //    at the DB - loading every transcript's full text just to filter in JS
  //    times out once the panel is large. Order by (published_at, id) for stable
  //    deep pagination; stop only on an empty page (see pagination guardrail).
  const episodes: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("episodes")
      .select(
        `id, title, published_at,
         channel:channels!episodes_channel_id_fkey ( name, political_lean )`,
      )
      .eq("transcript_status", "fetched")
      .gte("published_at", sinceIso)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + 999);
    if (error) {
      console.error("episodes query error:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    episodes.push(...data);
    if (data.length < 1000) break;
  }

  // 1b. Optional keyword pre-filter: collect episode_ids whose transcript
  //     matches any keyword, so we only classify plausibly-relevant episodes.
  //     Paginated per keyword; stop only on an empty/short page (pagination
  //     guardrail - never trust .limit() against the 1000-row cap).
  let keywordIds: Set<string> | null = null;
  if (TARGET_TABLE) {
    keywordIds = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from(TARGET_TABLE)
        .select("episode_id")
        .range(from, from + 999);
      if (error) {
        console.error(`target table (${TARGET_TABLE}) query error:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;
      for (const r of data as { episode_id: string }[]) keywordIds.add(r.episode_id);
      if (data.length < 1000) break;
    }
    console.log(`Target table ${TARGET_TABLE}: ${keywordIds.size} episode_ids.`);
  } else if (KEYWORDS.length > 0) {
    keywordIds = new Set<string>();
    for (const kw of KEYWORDS) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("transcripts")
          .select("episode_id")
          .ilike("text", `%${kw}%`)
          .range(from, from + 999);
        if (error) {
          console.error("keyword filter query error:", error.message);
          break;
        }
        if (!data || data.length === 0) break;
        for (const r of data as { episode_id: string }[]) keywordIds.add(r.episode_id);
        if (data.length < 1000) break;
      }
    }
    console.log(`Keyword filter [${KEYWORDS.join(", ")}] matched ${keywordIds.size} episodes (any window).`);
  }

  // 2. Candidates: not already backfilled, optionally keyword-matched, newest
  //    first, capped at limit.
  const candidateEpisodes = episodes
    .filter((e) => !done.has(e.id) && (!keywordIds || keywordIds.has(e.id)))
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  // 3. Fetch transcript text for just those candidates, in chunks (bounded).
  const txById = new Map<string, string>();
  const ids = candidateEpisodes.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data, error } = await db
      .from("transcripts")
      .select("episode_id, text")
      .in("episode_id", chunk);
    if (error) {
      console.error("transcripts query error:", error.message);
      continue;
    }
    for (const r of (data || []) as { episode_id: string; text: string }[]) {
      txById.set(r.episode_id, r.text);
    }
  }

  const candidates = candidateEpisodes
    .filter((e) => txById.has(e.id))
    .map((e) => ({ episode_id: e.id, text: txById.get(e.id)!, episode: e }));

  console.log(`${episodes.length} episodes in window; ${done.size} already backfilled; processing ${candidates.length}.\n`);

  let processed = 0;
  let inserted = 0;
  let failed = 0;
  let inTok = 0;
  let outTok = 0;

  await mapPool(candidates, BACKFILL_CONCURRENCY, async (t) => {
    try {
      const r = await classifyTranscript({
        transcript: t.text,
        channelName: t.episode?.channel?.name || "(unknown)",
        politicalLean: t.episode?.channel?.political_lean || "M",
        episodeTitle: t.episode?.title || "",
        publishedAt: t.episode?.published_at || new Date().toISOString(),
        issues: issuesTyped,
      });
      inTok += r.inputTokens || 0;
      outTok += r.outputTokens || 0;
      const newMentions = r.mentions.filter((m) => NEW_SLUGS.has(m.issue_slug));
      if (newMentions.length > 0) {
        const { error } = await db.from("classifications").insert(
          newMentions.map((m) => ({
            episode_id: t.episode_id,
            issue_slug: m.issue_slug,
            supporting_quote: m.supporting_quote,
          })),
        );
        if (!error) inserted += newMentions.length;
      }
    } catch (e: any) {
      failed++;
    }
    processed++;
    if (processed % 50 === 0) {
      const cost = estimateCostUsd(MODEL_CLASSIFY, { inputTokens: inTok, outputTokens: outTok });
      console.log(`[${processed}/${candidates.length}] new mentions inserted: ${inserted} · ~$${cost.toFixed(2)} · failed ${failed}`);
    }
  });

  const cost = estimateCostUsd(MODEL_CLASSIFY, { inputTokens: inTok, outputTokens: outTok });
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Processed ${processed} episodes; inserted ${inserted} new-issue classifications; failed ${failed}.`);
  console.log(`Tokens — in ${inTok.toLocaleString()}, out ${outTok.toLocaleString()} (~$${cost.toFixed(2)})`);

  // Record this one-off backfill so /admin/costs reflects it (it's a big, manual
  // classify spend that the cron-only log would otherwise miss entirely).
  await recordScriptRun({
    label: `backfill-issues ${windowDays}d`,
    source: "manual",
    durationMs: Date.now() - startedAt,
    classify: { processed, mentions: inserted, failed },
    inputTokens: inTok,
    outputTokens: outTok,
    costUsd: cost,
    raw: { windowDays, newSlugs: [...NEW_SLUGS] },
  });

  console.log(`\nNext: npm run score -- ${Math.max(inserted, 100)}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
