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

interface PendingEpisode {
  id: string;
  title: string;
  published_at: string;
  channel: {
    name: string;
    political_lean: "L" | "M" | "R";
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

  // Find pending episodes — episodes with a transcript that haven't been
  // classified yet. The queue key is `episodes.classify_status` ('pending'
  // until processed), set to 'processed' after each attempt REGARDLESS of
  // mention count (the head-of-line-blocking fix from v0.6.29).
  //
  // We query episodes-first (not transcripts) so we don't have to drag the
  // full transcript `text` column across every row of the entire transcripts
  // table. At ~50–200KB per transcript and 1700+ rows, the old embed-and-
  // filter approach hit Postgres's statement timeout. The text is fetched
  // on-demand inside the loop, one episode at a time.
  //
  // CRITICAL: paginate via .range() with a stable .order(). Supabase enforces
  // a 1000-row Max Rows cap that silently truncates .limit().
  const PAGE = 1000;
  const MAX_PAGES = 500;

  const allPending: PendingEpisode[] = [];
  for (let from = 0, pages = 0; pages < MAX_PAGES; pages++, from += PAGE) {
    const { data, error } = await db
      .from("episodes")
      .select(
        `id, title, published_at,
         channel:channels!episodes_channel_id_fkey (name, political_lean)`,
      )
      .eq("classify_status", "pending")
      .eq("transcript_status", "fetched")
      // Newest first — recent backlog drains first, matches editorial value.
      // Chain `id` as the unique tiebreaker; without it, episodes published
      // in the same second can re-cross page boundaries. (See
      // [[pagination-stable-order]] — the non-unique-key subspecies.)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Failed to load pending episodes:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allPending.push(...(data as unknown as PendingEpisode[]));
    // Empty-page-only termination — a short page on this filtered query is
    // routine (response-size cap with the channel join). v0.6.53 removed
    // the old `data.length < PAGE` early-out for the same reason score.ts
    // got its fix in this version.
  }

  if (allPending.length === 0) {
    console.log("All transcripts already classified. Nothing to do.");
    return;
  }
  console.log(`Found ${allPending.length} unclassified transcripts. Processing first ${Math.min(limit, allPending.length)}.\n`);

  let totalMentions = 0;
  let totalOffTopics = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let failed = 0;

  const slice = allPending.slice(0, limit);
  for (let i = 0; i < slice.length; i++) {
    const ep = slice[i];
    const truncatedTitle = (ep.title || "(no title)").slice(0, 80);
    const channelName = ep.channel?.name || "(unknown)";
    const lean = ep.channel?.political_lean || "M";

    console.log(`[${i + 1}/${slice.length}] [${lean}] ${channelName}`);
    console.log(`    ${truncatedTitle}`);

    // Load this episode's transcript on demand — keeps per-iteration payload
    // small (one transcript, not all of them).
    const { data: tRow, error: tErr } = await db
      .from("transcripts")
      .select("text")
      .eq("episode_id", ep.id)
      .maybeSingle();
    if (tErr || !tRow?.text) {
      console.log(`    ✗ transcript missing (${tErr?.message || "no row"})`);
      failed += 1;
      continue;
    }
    const text = tRow.text;
    console.log(`    transcript: ${text.length.toLocaleString()} chars`);

    try {
      const result = await classifyTranscript({
        transcript: text,
        channelName,
        politicalLean: lean,
        episodeTitle: ep.title || "",
        publishedAt: ep.published_at || new Date().toISOString(),
        issues: issuesTyped,
      });

      totalInputTokens += result.inputTokens || 0;
      totalOutputTokens += result.outputTokens || 0;

      // Emerging-issue discovery: harvest off-taxonomy topics regardless of
      // mention count (off-taxonomy episodes are exactly where new issues hide).
      if (result.offTopics.length > 0) {
        const { error: topicErr } = await db.from("discovery_topics").insert(
          result.offTopics.map((o) => ({
            episode_id: ep.id,
            label: o.topic,
            quote: o.supporting_quote,
          })),
        );
        if (!topicErr) totalOffTopics += result.offTopics.length;
      }

      // Mark processed regardless of mention count so off-taxonomy episodes
      // aren't reprocessed on every run (head-of-line-blocking fix, v0.6.29).
      const markProcessed = () =>
        db
          .from("episodes")
          .update({ classify_status: "processed" })
          .eq("id", ep.id);

      if (result.mentions.length === 0) {
        console.log(`    ○ no taxonomy issues detected`);
        await markProcessed();
        continue;
      }

      // Insert all mentions
      const rows = result.mentions.map((m) => ({
        episode_id: ep.id,
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
  console.log(`Processed: ${slice.length}, mentions written: ${totalMentions}, off-topics: ${totalOffTopics}, failed: ${failed}`);
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
