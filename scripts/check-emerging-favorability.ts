/**
 * Validation spot-check for the emerging-favorability scorer (NOT a pipeline
 * stage, NOT a DB write). Reads a sample of one emerging event's mentions,
 * scores each with scoreEmergingMention, and prints lean + favorability + quote
 * so the signs can be eyeballed against obvious quotes: a "tragically tacky"
 * line should land < 0, "most American event ever" > 0, straight reporting ~ 0.
 *
 * This is the v1 validation gate for a NEW scoring axis the L/R gold set doesn't
 * cover (a dedicated favorability gold set gates it before MCP). Reads only.
 *
 * Run:  npx tsx scripts/check-emerging-favorability.ts [keyword] [limit]
 *       (defaults: keyword "ufc", limit 40)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { scoreEmergingMention } from "@/modules/score";
import { mapPool } from "@/lib/concurrency";

const KEYWORD = process.argv[2] || "ufc";
const LIMIT = Number(process.argv[3]) || 40;

async function main() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("discovery_topics")
    .select(
      `id, label, quote,
       episode:episodes!discovery_topics_episode_id_fkey (
         channel:channels!episodes_channel_id_fkey ( name, political_lean )
       )`,
    )
    .ilike("quote", `%${KEYWORD}%`)
    .not("quote", "is", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);

  interface Row {
    label: string;
    quote: string;
    channel: string;
    lean: "L" | "M" | "R";
  }
  const rows: Row[] = [];
  for (const r of (data as any[]) || []) {
    const ch = r.episode?.channel;
    if (!ch || !r.quote) continue;
    const lean: "L" | "M" | "R" =
      ch.political_lean === "L" || ch.political_lean === "R" ? ch.political_lean : "M";
    rows.push({ label: r.label, quote: r.quote, channel: ch.name, lean });
  }

  console.log(`Scoring ${rows.length} "${KEYWORD}" mentions for favorability...\n`);

  const scored: { lean: string; fav: number; channel: string; quote: string }[] = [];
  await mapPool(rows, 10, async (r) => {
    try {
      const res = await scoreEmergingMention({
        quote: r.quote,
        channelName: r.channel,
        politicalLean: r.lean,
        subject: r.label,
      });
      scored.push({ lean: r.lean, fav: res.favorability, channel: r.channel, quote: r.quote });
    } catch (e: any) {
      console.error(`  score failed (${r.channel}): ${e?.message || e}`);
    }
  });

  // Print sorted most-critical first so the extremes are easy to sanity-check.
  scored.sort((a, b) => a.fav - b.fav);
  for (const s of scored) {
    const sign = s.fav > 0 ? `+${s.fav.toFixed(1)}` : s.fav.toFixed(1);
    console.log(`[${s.lean}] ${sign.padStart(5)}  ${s.channel}`);
    console.log(`        "${s.quote.slice(0, 120).replace(/\s+/g, " ")}"`);
  }

  // Per-lean means: expect L < M < R for a partisan controversy like this one.
  const byLean = (l: string) => scored.filter((s) => s.lean === l).map((s) => s.fav);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  console.log("\nMean favorability by lean (expect L most critical, R most favorable):");
  for (const l of ["L", "M", "R"] as const) {
    const xs = byLean(l);
    console.log(`  ${l}: ${xs.length ? mean(xs).toFixed(2) : "n/a"}  (n=${xs.length})`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
