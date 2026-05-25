/**
 * Classify pending transcripts.
 *
 * For each transcript whose episode has no classifications yet, run the
 * classify module and write the resulting (issue_slug, supporting_quote) rows
 * into the classifications table.
 *
 * Run with:  npm run classify
 * Override:  npm run classify -- <limit>
 *            e.g. npm run classify -- 10
 *
 * Conservative defaults (limit=10) so you can see quality before fanning out.
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { classifyTranscript, type IssueDef } from "@/modules/classify";
import { MODEL_CLASSIFY } from "@/lib/anthropic";

interface PendingTranscript {
  episode_id: string;
  text: string;
  episode: {
    title: string;
    published_at: string;
    classify_status: string;
    channel: {
      name: string;
      political_lean: "L" | "M" | "R";
    };
  };
}

async function main() {
  const limit = parseInt(process.argv[2] || "10", 10);

  console.log(`\nSoapbox classify`);
  console.log(`─`.repeat(60));
  console.log(`Processing up to ${limit} unclassified transcripts using ${MODEL_CLASSIFY}\n`);

  const db = createServiceClient();

  // Load issue taxonomy once
  const { data: issues, error: issuesErr } = await db
    .from("issues")
    .select("slug, name, definition")
    .eq("active", true);

  if (issuesErr || !issues || issues.length === 0) {
    console.error("Could not load issues table:", issuesErr?.message);
    process.exit(1);
  }
  const issuesTyped = issues as IssueDef[];
  console.log(`Loaded ${issuesTyped.length} issues from taxonomy.\n`);

  // Find transcripts whose episode hasn't been run through classify yet. The
  // queue key is `episodes.classify_status` ('pending' until processed), which
  // is set to 'processed' after each attempt REGARDLESS of mention count. This
  // is what stops 0-mention (off-taxonomy) episodes from being reprocessed
  // every run — the head-of-line-blocking loop fixed in v0.6.29.
  //
  // CRITICAL: must paginate via .range(). Supabase/PostgREST enforces a
  // project-level "Max Rows" cap (default 1000) that silently truncates
  // .limit() — a large .limit(50000) still returns at most 1000 rows. Only
  // .range() pagination walks the full set regardless of the Max Rows cap.
  const PAGE = 1000;
  const MAX_PAGES = 500; // safety bound (~500k rows) — never expected to hit

  const allTranscripts: PendingTranscript[] = [];
  for (let from = 0, pages = 0; pages < MAX_PAGES; pages++, from += PAGE) {
    const { data, error } = await db
      .from("transcripts")
      .select(
        `
        episode_id, text,
        episode:episodes!transcripts_episode_id_fkey (
          title, published_at, classify_status,
          channel:channels!episodes_channel_id_fkey (
            name, political_lean
          )
        )
      `,
      )
      // Stable order is required for correct .range() pagination — without it
      // Postgres may return rows in an inconsistent order across pages.
      .order("episode_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Failed to load transcripts:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break; // terminate only on an empty page
    allTranscripts.push(...(data as unknown as PendingTranscript[]));
  }

  const pending = allTranscripts.filter(
    (t) => t.episode?.classify_status !== "processed",
  );

  if (pending.length === 0) {
    console.log("All transcripts already classified. Nothing to do.");
    return;
  }
  console.log(`Found ${pending.length} unclassified transcripts. Processing first ${Math.min(limit, pending.length)}.\n`);

  let totalMentions = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let failed = 0;

  const slice = pending.slice(0, limit);
  for (let i = 0; i < slice.length; i++) {
    const t = slice[i];
    const truncatedTitle = (t.episode?.title || "(no title)").slice(0, 80);
    const channelName = t.episode?.channel?.name || "(unknown)";
    const lean = t.episode?.channel?.political_lean || "M";

    console.log(`[${i + 1}/${slice.length}] [${lean}] ${channelName}`);
    console.log(`    ${truncatedTitle}`);
    console.log(`    transcript: ${t.text.length.toLocaleString()} chars`);

    try {
      const result = await classifyTranscript({
        transcript: t.text,
        channelName,
        politicalLean: lean,
        episodeTitle: t.episode?.title || "",
        publishedAt: t.episode?.published_at || new Date().toISOString(),
        issues: issuesTyped,
      });

      totalInputTokens += result.inputTokens || 0;
      totalOutputTokens += result.outputTokens || 0;

      // Mark processed regardless of mention count so off-taxonomy episodes
      // aren't reprocessed on every run (head-of-line-blocking fix, v0.6.29).
      const markProcessed = () =>
        db
          .from("episodes")
          .update({ classify_status: "processed" })
          .eq("id", t.episode_id);

      if (result.mentions.length === 0) {
        console.log(`    ○ no taxonomy issues detected`);
        await markProcessed();
        continue;
      }

      // Insert all mentions
      const rows = result.mentions.map((m) => ({
        episode_id: t.episode_id,
        issue_slug: m.issue_slug,
        supporting_quote: m.supporting_quote,
      }));
      const { error: insErr } = await db.from("classifications").insert(rows);
      if (insErr) {
        // Leave pending so it retries; marking processed would lose mentions.
        console.log(`    ✗ insert failed: ${insErr.message}`);
        failed += 1;
        continue;
      }
      await markProcessed();

      totalMentions += result.mentions.length;
      const byIssue = result.mentions.reduce<Record<string, number>>((acc, m) => {
        acc[m.issue_slug] = (acc[m.issue_slug] || 0) + 1;
        return acc;
      }, {});
      const summary = Object.entries(byIssue)
        .map(([slug, n]) => `${slug}×${n}`)
        .join(", ");
      console.log(`    ✓ ${result.mentions.length} mentions: ${summary}`);
    } catch (e: any) {
      console.log(`    ✗ ${e.message}`);
      failed += 1;
    }
  }

  // Summary
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Processed: ${slice.length}, mentions written: ${totalMentions}, failed: ${failed}`);
  console.log(`Tokens — input: ${totalInputTokens.toLocaleString()}, output: ${totalOutputTokens.toLocaleString()}`);
  // Rough cost estimate at Sonnet 4.6 prices ($3/Mtok input, $15/Mtok output)
  const cost = (totalInputTokens * 3) / 1_000_000 + (totalOutputTokens * 15) / 1_000_000;
  console.log(`Approx cost this run: $${cost.toFixed(3)}`);

  const { count } = await db
    .from("classifications")
    .select("*", { count: "exact", head: true });
  console.log(`Classifications table now contains: ${count} rows`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
