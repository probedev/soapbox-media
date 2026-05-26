/**
 * One-time harvest-only backfill for emerging-issue discovery.
 *
 * Re-runs the (new) classify pass over recent transcripts but writes ONLY the
 * off-taxonomy topics into discovery_topics — it does NOT insert classifications
 * (those episodes are already classified, so we must not duplicate them). Lets
 * us populate + test discovery without waiting for days of cron harvest.
 * Idempotent: skips episodes that already have discovery_topics rows.
 *
 * Run with:  npm run discover:backfill -- <limit>   (default 40)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { classifyTranscript, type IssueDef } from "@/modules/classify";

async function main() {
  const limit = parseInt(process.argv[2] || "40", 10);
  const db = createServiceClient();

  const { data: issues } = await db
    .from("issues")
    .select("slug, name, definition")
    .eq("active", true);
  const issuesTyped = (issues || []) as IssueDef[];
  console.log(`\nDiscovery backfill (harvest-only) — up to ${limit} recent transcripts`);
  console.log(`Taxonomy: ${issuesTyped.length} issues\n`);

  // Episodes that already have harvested topics — skip (idempotent).
  const already = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("discovery_topics")
      .select("episode_id")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data as { episode_id: string }[]) already.add(r.episode_id);
    if (data.length < 1000) break;
  }

  // Recent transcripts + episode/channel context (paginate, then sort in JS).
  const transcripts: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("transcripts")
      .select(
        `episode_id, text,
         episode:episodes!transcripts_episode_id_fkey (
           title, published_at,
           channel:channels!episodes_channel_id_fkey ( name, political_lean )
         )`,
      )
      .range(from, from + 999);
    if (error) {
      console.error("transcripts query error:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    transcripts.push(...data);
    if (data.length < 1000) break;
  }
  console.log(
    `Loaded ${transcripts.length} transcripts; ${already.size} episodes already harvested; ` +
      `${transcripts.filter((t) => t.episode).length} have episode context.`,
  );

  const candidates = transcripts
    .filter((t) => t.episode && !already.has(t.episode_id))
    .sort(
      (a, b) =>
        new Date(b.episode.published_at).getTime() - new Date(a.episode.published_at).getTime(),
    )
    .slice(0, limit);

  console.log(`Processing ${candidates.length} episodes (newest first)…\n`);

  let totalTopics = 0;
  let inTok = 0;
  let outTok = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i];
    const ch = t.episode?.channel?.name || "(unknown)";
    try {
      const result = await classifyTranscript({
        transcript: t.text,
        channelName: ch,
        politicalLean: t.episode?.channel?.political_lean || "M",
        episodeTitle: t.episode?.title || "",
        publishedAt: t.episode?.published_at || new Date().toISOString(),
        issues: issuesTyped,
      });
      inTok += result.inputTokens || 0;
      outTok += result.outputTokens || 0;
      if (result.offTopics.length > 0) {
        const { error } = await db.from("discovery_topics").insert(
          result.offTopics.map((o) => ({
            episode_id: t.episode_id,
            label: o.topic,
            quote: o.supporting_quote,
          })),
        );
        if (!error) {
          totalTopics += result.offTopics.length;
          console.log(`[${i + 1}/${candidates.length}] ${ch}: ${result.offTopics.map((o) => o.topic).join(", ")}`);
        }
      } else {
        console.log(`[${i + 1}/${candidates.length}] ${ch}: (none)`);
      }
    } catch (e: any) {
      failed += 1;
      console.log(`[${i + 1}/${candidates.length}] ${ch}: ✗ ${e.message}`);
    }
  }

  const cost = (inTok * 3) / 1_000_000 + (outTok * 15) / 1_000_000;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Off-topics harvested: ${totalTopics} across ${candidates.length} episodes (failed: ${failed})`);
  console.log(`Tokens — in ${inTok.toLocaleString()}, out ${outTok.toLocaleString()} (~$${cost.toFixed(3)})`);
  console.log(`\nNext: npm run discover`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
