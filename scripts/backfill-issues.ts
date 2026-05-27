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

// The gap issues activated 2026-05-27. Only these get inserted here.
const NEW_SLUGS = new Set([
  "health-care",
  "entitlements",
  "justice-system",
  "govt-corruption",
  "gun-policy",
  "drug-policy",
  "race-discrimination",
]);

async function main() {
  const windowDays = parseInt(process.argv[2] || "30", 10);
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity;
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

  const candidates = transcripts
    .filter(
      (t) =>
        t.episode &&
        new Date(t.episode.published_at) >= since &&
        !done.has(t.episode_id),
    )
    .sort(
      (a, b) =>
        new Date(b.episode.published_at).getTime() - new Date(a.episode.published_at).getTime(),
    )
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`${transcripts.length} transcripts loaded; ${done.size} episodes already backfilled; processing ${candidates.length}.\n`);

  let processed = 0;
  let inserted = 0;
  let failed = 0;
  let inTok = 0;
  let outTok = 0;

  for (const t of candidates) {
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
      processed++;
      if (processed % 25 === 0) {
        const cost = (inTok * 3) / 1_000_000 + (outTok * 15) / 1_000_000;
        console.log(`[${processed}/${candidates.length}] new mentions inserted: ${inserted} · ~$${cost.toFixed(2)} · failed ${failed}`);
      }
    } catch (e: any) {
      failed++;
    }
  }

  const cost = (inTok * 3) / 1_000_000 + (outTok * 15) / 1_000_000;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Processed ${processed} episodes; inserted ${inserted} new-issue classifications; failed ${failed}.`);
  console.log(`Tokens — in ${inTok.toLocaleString()}, out ${outTok.toLocaleString()} (~$${cost.toFixed(2)})`);
  console.log(`\nNext: npm run score -- ${Math.max(inserted, 100)}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
