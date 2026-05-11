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

  // Find transcripts whose episode has no classifications
  // Supabase lacks a native NOT EXISTS join in select(), so we fetch all
  // transcripts then filter against the classifications set in memory.
  // Supabase defaults to 1000-row limit on .select() — bump explicitly so the
  // pending-transcript diff and existing-classifications diff are complete.
  const { data: allTranscripts, error: txErr } = await db
    .from("transcripts")
    .select(
      `
      episode_id, text,
      episode:episodes!transcripts_episode_id_fkey (
        title, published_at,
        channel:channels!episodes_channel_id_fkey (
          name, political_lean
        )
      )
    `,
    )
    .limit(50000);
  if (txErr) {
    console.error("Failed to load transcripts:", txErr.message);
    process.exit(1);
  }
  const { data: existingClassifications } = await db
    .from("classifications")
    .select("episode_id")
    .limit(50000);
  const classifiedEpisodeIds = new Set(
    (existingClassifications || []).map((c: { episode_id: string }) => c.episode_id),
  );

  const pending = (allTranscripts as unknown as PendingTranscript[]).filter(
    (t) => !classifiedEpisodeIds.has(t.episode_id),
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

      if (result.mentions.length === 0) {
        console.log(`    ○ no taxonomy issues detected`);
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
        console.log(`    ✗ insert failed: ${insErr.message}`);
        failed += 1;
        continue;
      }

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
