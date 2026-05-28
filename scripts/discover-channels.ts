/**
 * Channel-expansion candidate finder.
 *
 * For each of our active YouTube channels, pull the host's curated "Featured
 * Channels" list via the YT Data API (1 quota unit per channel). Aggregate,
 * dedup against the existing panel, fetch subscriber counts in batches, and
 * print ≥300K-sub candidates ranked by how many of OUR channels endorse them.
 *
 * Pure read-only — does not modify the DB. Output is a ranked list for
 * editorial triage. See docs/channel-expansion-strategy.md.
 *
 * Run:  npm run discover:channels
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getFeaturedChannels, getChannelDetailsBatch } from "@/lib/youtube";

const SUB_FLOOR = 300_000;

async function main() {
  const db = createServiceClient();
  const { data: channels, error } = await db
    .from("channels")
    .select("name, platform_id")
    .eq("platform", "youtube")
    .eq("active", true);
  if (error) throw new Error(`load channels: ${error.message}`);
  const our = (channels || []) as { name: string; platform_id: string }[];
  const ownedIds = new Set(our.map((c) => c.platform_id));

  console.log(`\nChannel-expansion candidates — featured-by ${our.length} active YT channels (≥${SUB_FLOOR.toLocaleString()} subs)\n`);

  // For each owned channel, pull its featured channels. Track which of ours
  // endorsed each candidate (the "feature count" signal).
  const featuredBy = new Map<string, Set<string>>(); // candidateId → set of OUR channel names

  for (const ch of our) {
    try {
      const featured = await getFeaturedChannels(ch.platform_id);
      for (const id of featured) {
        if (ownedIds.has(id)) continue; // skip ones we already have
        const set = featuredBy.get(id) || new Set<string>();
        set.add(ch.name);
        featuredBy.set(id, set);
      }
    } catch (e: any) {
      console.warn(`  [${ch.name}] featured-channels fetch failed: ${e.message}`);
    }
  }

  const candidateIds = [...featuredBy.keys()];
  if (candidateIds.length === 0) {
    console.log("No featured channels surfaced (or none of our channels expose them publicly).");
    return;
  }
  console.log(`${candidateIds.length} unique candidates surfaced; fetching subscriber counts…\n`);

  const details = await getChannelDetailsBatch(candidateIds);

  const rows = candidateIds
    .map((id) => {
      const d = details.get(id);
      const sources = [...(featuredBy.get(id) || [])];
      return {
        id,
        title: d?.title || "(unknown)",
        subs: d?.subscriberCount || 0,
        endorsements: sources.length,
        sources,
      };
    })
    .filter((r) => r.subs >= SUB_FLOOR)
    .sort((a, b) => b.endorsements - a.endorsements || b.subs - a.subs);

  if (rows.length === 0) {
    console.log(`No candidates above the ${SUB_FLOOR.toLocaleString()}-sub floor.`);
    console.log(`(${candidateIds.length} total surfaced, all sub-threshold.)`);
    return;
  }

  console.log(`Title · Subs · Endorsements · Endorsed by`);
  console.log("─".repeat(60));
  for (const r of rows) {
    const sub = r.subs >= 1_000_000 ? `${(r.subs / 1_000_000).toFixed(1)}M` : `${Math.round(r.subs / 1000)}K`;
    const srcs = r.sources.slice(0, 3).join(", ") + (r.sources.length > 3 ? `, +${r.sources.length - 3}` : "");
    console.log(`${r.title}  ·  ${sub}  ·  ${r.id}  ·  ${r.endorsements}  ·  ${srcs}`);
  }
  console.log(`\n${rows.length} candidates ≥${SUB_FLOOR.toLocaleString()} subs (${candidateIds.length - rows.length} below floor).`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
