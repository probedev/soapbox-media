/**
 * Score pending classifications.
 *
 * For each classification that doesn't yet have a sentiment_score, run the
 * score module (Haiku 4.5) and write the result into sentiment_scores.
 *
 * Run with:  npm run score
 * Override:  npm run score -- <limit>
 *            e.g. npm run score -- 100
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { scoreClassification } from "@/modules/score";
import { MODEL_SCORE } from "@/lib/anthropic";

interface PendingClassification {
  id: string;
  episode_id: string;
  issue_slug: string;
  supporting_quote: string;
  issue: {
    name: string;
    definition: string;
    left_position: string;
    right_position: string;
  };
  episode: {
    channel: {
      name: string;
      political_lean: "L" | "M" | "R";
    };
  };
}

async function main() {
  const limit = parseInt(process.argv[2] || "50", 10);

  console.log(`\nSoapbox score`);
  console.log(`─`.repeat(60));
  console.log(`Processing up to ${limit} unscored classifications using ${MODEL_SCORE}\n`);

  const db = createServiceClient();

  // Paginate through all classifications. The canonical pattern (see
  // [[pagination-stable-order]] / v0.6.47 + v0.6.51 + v0.6.52) is:
  //   1. .order(<stable_unique_key>) — without it Postgres returns
  //      non-deterministic pages once the table grows past 1000 rows.
  //   2. Terminate ONLY on an empty page (data.length === 0). A short page
  //      means Vercel's edge→Supabase route hit the response-size cap
  //      before the row cap on this deep-join query (each row carries a
  //      multi-field issue+channel join) — NOT end-of-data.
  //
  // The old short-page early-out (`data.length < pageSize`) silently dropped
  // ~all of the catchup's classifications during the 2026-05-29 drain: 600
  // scored, 5,809 stranded, "queue drained" sentinel fired anyway. v0.6.53.
  const allClassifications: PendingClassification[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("classifications")
      .select(
        `
        id, episode_id, issue_slug, supporting_quote,
        issue:issues!classifications_issue_slug_fkey (
          name, definition, left_position, right_position
        ),
        episode:episodes!classifications_episode_id_fkey (
          channel:channels!episodes_channel_id_fkey (
            name, political_lean
          )
        )
      `,
      )
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("Failed to load classifications:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allClassifications.push(...(data as unknown as PendingClassification[]));
  }

  // Same canonical pagination for existing scores — narrow query but the
  // sentiment_scores table is the larger of the two (one row per scored
  // mention) and will definitely span pages.
  const existingScores: { classification_id: string }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("sentiment_scores")
      .select("classification_id")
      // UNIQUE(classification_id) makes it a stable pagination key.
      .order("classification_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("Failed to load existing scores:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    existingScores.push(...data);
  }
  const scoredIds = new Set(existingScores.map((s) => s.classification_id));
  console.log(
    `Loaded ${allClassifications.length} classifications and ${existingScores.length} existing scores.`,
  );

  const pending = allClassifications.filter((c) => !scoredIds.has(c.id));

  if (pending.length === 0) {
    console.log("All classifications already scored. Nothing to do.");
    return;
  }
  console.log(`Found ${pending.length} unscored classifications. Processing first ${Math.min(limit, pending.length)}.\n`);

  const slice = pending.slice(0, limit);
  let ok = 0;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const channelName = c.episode?.channel?.name || "(unknown)";
    const lean = c.episode?.channel?.political_lean || "M";
    const truncQuote = c.supporting_quote.slice(0, 100);

    try {
      const result = await scoreClassification({
        quote: c.supporting_quote,
        channelName,
        politicalLean: lean,
        issueName: c.issue.name,
        issueDefinition: c.issue.definition,
        leftPosition: c.issue.left_position,
        rightPosition: c.issue.right_position,
      });

      totalInputTokens += result.inputTokens || 0;
      totalOutputTokens += result.outputTokens || 0;

      const { error: insErr } = await db.from("sentiment_scores").upsert(
        {
          classification_id: c.id,
          sentiment: result.sentiment,
          intensity: result.intensity,
          supporting_quote: c.supporting_quote,
          model: MODEL_SCORE,
          model_version: "v0",
        },
        // Idempotent: a UNIQUE(classification_id) constraint backs this, so
        // overlapping score runs (CLI + cron) no-op instead of inserting a
        // duplicate score. See 2026-05-24 dedup incident.
        { onConflict: "classification_id", ignoreDuplicates: true },
      );
      if (insErr) {
        console.log(`[${i + 1}/${slice.length}] ✗ insert: ${insErr.message}`);
        failed += 1;
        continue;
      }

      const dir = result.sentiment > 0 ? "R" : result.sentiment < 0 ? "L" : "·";
      console.log(
        `[${i + 1}/${slice.length}] [${lean}] ${channelName.slice(0, 24).padEnd(24)} ${c.issue_slug.padEnd(18)} ${dir}${Math.abs(result.sentiment).toFixed(1).padStart(4)}  i${result.intensity}  "${truncQuote}${c.supporting_quote.length > 100 ? "…" : ""}"`,
      );
      ok += 1;
    } catch (e: any) {
      console.log(`[${i + 1}/${slice.length}] ✗ ${e.message}`);
      failed += 1;
    }
  }

  // Summary
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scored: ${ok}, failed: ${failed}`);
  console.log(`Tokens — input: ${totalInputTokens.toLocaleString()}, output: ${totalOutputTokens.toLocaleString()}`);
  // Haiku 4.5 pricing (rough): $1/Mtok input, $5/Mtok output
  const cost = (totalInputTokens * 1) / 1_000_000 + (totalOutputTokens * 5) / 1_000_000;
  console.log(`Approx cost this run: $${cost.toFixed(3)}`);

  const { count } = await db
    .from("sentiment_scores")
    .select("*", { count: "exact", head: true });
  console.log(`Sentiment_scores table now contains: ${count} rows`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
