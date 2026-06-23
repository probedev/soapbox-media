/**
 * Detect public-figure mentions in episode transcripts and upsert candidate
 * favorability windows into `figure_mentions`. No LLM (cheap); the Haiku
 * favorability pass runs separately over the rows this produces.
 *
 * Whole-word alias matching (src/lib/figures.ts), nearby-mention dedup, ad-read
 * filter, and a per-figure-per-episode cap keep the window set bounded. start_ts
 * comes free from YouTube caption markers embedded in the text.
 *
 * Paginated with .range() + stop-on-empty (Supabase 1000-row cap guardrail).
 *
 * Run:  npm run detect:figures            (last 120 days)
 *       npm run detect:figures -- 365      (last N days; use a big N for full)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { buildAliasRegex, extractWindows, type FigureMatcher } from "@/lib/figures";

const PAGE = 150; // transcripts are large; keep pages small

async function main() {
  const days = parseInt(process.argv[2] || "120", 10);
  const db = createServiceClient();

  const { data: figs, error: figErr } = await db
    .from("figures")
    .select("slug, aliases")
    .eq("active", true);
  if (figErr) throw new Error(`load figures: ${figErr.message}`);
  const matchers: FigureMatcher[] = (figs || []).map((f: any) => ({
    slug: f.slug,
    regex: buildAliasRegex(f.aliases || []),
  }));
  if (matchers.length === 0) throw new Error("no active figures");

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  console.log(`\nDetect figures - ${matchers.length} figures, transcripts published in last ${days}d\n`);

  let from = 0;
  let scanned = 0;
  let windows = 0;
  let inserted = 0;

  for (;;) {
    const { data, error } = await db
      .from("transcripts")
      .select("episode_id, text, episodes!inner(published_at)")
      .gte("episodes.published_at", cutoff)
      .order("episode_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`page ${from}: ${error.message}`);
    if (!data || data.length === 0) break;

    const rows: any[] = [];
    for (const t of data as any[]) {
      scanned += 1;
      if (!t.text) continue;
      for (const w of extractWindows(t.text, matchers)) {
        windows += 1;
        rows.push({
          episode_id: t.episode_id,
          figure_slug: w.figureSlug,
          quote: w.quote,
          char_offset: w.charOffset,
          start_ts: w.startTs,
          matched_alias: w.matchedAlias,
        });
      }
    }

    // Batch upsert (idempotent on episode_id+figure_slug+char_offset).
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: upErr, count } = await db
        .from("figure_mentions")
        .upsert(chunk, { onConflict: "episode_id,figure_slug,char_offset", ignoreDuplicates: true, count: "exact" });
      if (upErr) throw new Error(`upsert: ${upErr.message}`);
      inserted += count ?? 0;
    }

    console.log(`  scanned ${scanned} transcripts | ${windows} windows | ${inserted} new mentions`);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`\n${"-".repeat(56)}`);
  console.log(`Done. ${scanned} transcripts scanned, ${windows} windows, ${inserted} new mentions upserted.`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
