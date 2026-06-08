/**
 * READ-ONLY accuracy probe for the Trending Names beta: take one entity and
 * show WHY it ranked — daily mention trajectory (real spike vs flat-high),
 * distinct-channel spread, and sampled ±context snippets bucketed by usage
 * type (citation / bestseller-ad / other) to judge whether the breadth is
 * substantive.
 *
 * Run: npx tsx scripts/probe-entity-context.ts "new york times"
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";

const TERM = (process.argv.slice(2).find((a) => !a.startsWith("-")) || "new york times").toLowerCase();
const DAYS = 21;
const RECENT_DAYS = 7;
const DAY = 86_400_000;

function classify(ctx: string): string {
  const c = ctx.toLowerCase();
  if (/best ?sell|bestselling|new york times best/.test(c)) return "bestseller/book";
  if (/sponsor|brought to you|promo code|dot com|subscribe to|advertisement/.test(c)) return "ad/sponsor";
  if (/according to|reported|reporting|report|story|article|op-?ed|piece|wrote|writes|columnist|headline|published/.test(c)) return "citation";
  return "other";
}

async function main() {
  const db = createServiceClient();
  const start = new Date(Date.now() - DAYS * DAY).toISOString();
  const recentCut = Date.now() - RECENT_DAYS * DAY;

  const perDay = new Map<string, number>();
  const recentChans = new Set<string>();
  const baseChans = new Set<string>();
  const buckets = new Map<string, number>();
  const samples: { ch: string; snip: string; bucket: string }[] = [];
  let recentHits = 0, baseHits = 0;

  const pageSize = 200;
  for (let page = 0; page < 200; page++) {
    const { data, error } = await db
      .from("transcripts")
      .select(
        `text,
         episode:episodes!transcripts_episode_id_fkey!inner (
           published_at,
           channel:channels!episodes_channel_id_fkey!inner ( name, active )
         )`,
      )
      .eq("episode.channel.active", true)
      .gte("episode.published_at", start)
      .order("episode_id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      if (!r.text) continue;
      const lower = r.text.toLowerCase();
      let idx = lower.indexOf(TERM);
      if (idx < 0) continue;
      const ts = Date.parse(r.episode.published_at);
      const isRecent = ts >= recentCut;
      const ch = r.episode.channel.name as string;
      const day = new Date(ts).toISOString().slice(5, 10);
      let countInDoc = 0;
      while (idx >= 0) {
        countInDoc++;
        if (samples.length < 5000 && (isRecent)) {
          const raw = r.text.slice(Math.max(0, idx - 70), idx + TERM.length + 70).replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
          const bucket = classify(raw);
          buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
          if (samples.length < 400) samples.push({ ch, snip: raw, bucket });
        }
        idx = lower.indexOf(TERM, idx + TERM.length);
      }
      perDay.set(day, (perDay.get(day) ?? 0) + countInDoc);
      if (isRecent) { recentHits += countInDoc; recentChans.add(ch); }
      else { baseHits += countInDoc; baseChans.add(ch); }
    }
  }

  console.log(`\nENTITY: "${TERM}"  (last ${DAYS}d)\n`);
  console.log(`recent ${RECENT_DAYS}d: ${recentHits} mentions across ${recentChans.size} channels`);
  console.log(`prior ${DAYS - RECENT_DAYS}d: ${baseHits} mentions across ${baseChans.size} channels`);
  console.log(`recent/day = ${(recentHits / RECENT_DAYS).toFixed(0)} vs baseline/day = ${(baseHits / (DAYS - RECENT_DAYS)).toFixed(0)}  → ${((recentHits / RECENT_DAYS) / (baseHits / (DAYS - RECENT_DAYS) || 1)).toFixed(2)}× per-mention\n`);

  console.log("DAILY TRAJECTORY (mentions/day):");
  const days = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(...days.map(([, n]) => n), 1);
  for (const [d, n] of days) console.log(`  ${d}  ${String(n).padStart(4)} ${"█".repeat(Math.round((n / max) * 40))}`);

  console.log("\nRECENT USAGE TYPE:");
  for (const [b, n] of [...buckets.entries()].sort((a, b2) => b2[1] - a[1])) console.log(`  ${b.padEnd(16)} ${n}`);

  console.log("\nSAMPLE CONTEXTS (recent, distinct channels):");
  const seen = new Set<string>();
  for (const s of samples) {
    if (seen.has(s.ch)) continue;
    seen.add(s.ch);
    console.log(`  [${s.bucket}] ${s.ch}: …${s.snip}…`);
    if (seen.size >= 18) break;
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
