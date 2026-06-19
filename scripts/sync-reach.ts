/**
 * Reach-favoring: weight a show by its measured YouTube audience, not a stale
 * podcast estimate. Two passes:
 *
 *   1. Dual-platform shows (a YouTube row AND a podcast row, same canonical
 *      show): set the podcast row's reach to the YouTube sibling's subscriber
 *      count. Pure DB, no API.
 *   2. Podcast-only shows we explicitly want favored (e.g. Joe Rogan, who has no
 *      YouTube row in the panel): resolve the YouTube channel by handle and set
 *      the podcast row's reach to its live subscriber count.
 *
 * Matters more now that the Index weights by sqrt(reach) (a 2x reach error is a
 * ~1.4x weight error, not ~5%), so the cleanest audience number wins.
 *
 * Dry run by default (prints the plan); pass --apply to write. Idempotent: a row
 * already at the target reach is skipped, so re-running is a no-op.
 *
 *   Audit:  npx tsx scripts/sync-reach.ts
 *   Apply:  npx tsx scripts/sync-reach.ts --apply
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { resolveChannelByHandle } from "@/lib/youtube";
import { groupByCanonicalShow } from "@/lib/canonical-show";

const APPLY = process.argv.includes("--apply");

// Podcast-only shows to weight by their YouTube audience. Shows that already have
// a YouTube row are handled automatically by pass 1 and don't belong here.
const PODCAST_ONLY_YT: { name: string; handle: string }[] = [
  { name: "The Joe Rogan Experience", handle: "@joerogan" },
];

interface ChannelRow {
  id: string;
  name: string;
  platform: "youtube" | "podcast";
  reach: number;
}

async function setReach(
  db: ReturnType<typeof createServiceClient>,
  id: string,
  reach: number,
): Promise<void> {
  const { error } = await db
    .from("channels")
    .update({ reach, reach_updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function main() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("channels")
    .select("id, name, platform, reach")
    .eq("active", true);
  if (error) throw new Error(error.message);
  const channels: ChannelRow[] = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    platform: c.platform,
    reach: Number(c.reach),
  }));

  let planned = 0;
  let applied = 0;

  // Pass 1: dual-platform shows -> podcast reach = YouTube sibling reach.
  console.log("Pass 1 - dual-platform shows (podcast reach <- YouTube subscribers):");
  for (const g of groupByCanonicalShow(channels)) {
    const yt = g.members.filter((m) => m.platform === "youtube");
    const pod = g.members.filter((m) => m.platform === "podcast");
    if (!yt.length || !pod.length) continue;
    const ytReach = Math.max(...yt.map((m) => m.reach));
    for (const p of pod) {
      if (p.reach === ytReach) continue;
      planned++;
      console.log(
        `  ${p.name.slice(0, 40).padEnd(40)} ${p.reach.toLocaleString().padStart(12)} -> ${ytReach.toLocaleString()}`,
      );
      if (APPLY) {
        await setReach(db, p.id, ytReach);
        applied++;
      }
    }
  }

  // Pass 2: podcast-only shows -> reach from YouTube subscriber count.
  console.log("\nPass 2 - podcast-only shows favored to YouTube audience:");
  for (const entry of PODCAST_ONLY_YT) {
    const rows = channels.filter((c) => c.name === entry.name && c.platform === "podcast");
    if (!rows.length) {
      console.log(`  ! ${entry.name}: no active podcast row, skipping`);
      continue;
    }
    const info = await resolveChannelByHandle(entry.handle);
    if (!info) {
      console.log(`  ! ${entry.name}: handle ${entry.handle} did not resolve, skipping`);
      continue;
    }
    console.log(
      `  ${entry.name} resolved ${entry.handle} -> "${info.title}" (${info.subscriberCount.toLocaleString()} subs)`,
    );
    for (const p of rows) {
      if (p.reach === info.subscriberCount) continue;
      planned++;
      console.log(
        `    ${p.reach.toLocaleString().padStart(12)} -> ${info.subscriberCount.toLocaleString()}`,
      );
      if (APPLY) {
        await setReach(db, p.id, info.subscriberCount);
        applied++;
      }
    }
  }

  console.log(
    `\n${APPLY ? `Applied ${applied} update(s).` : `Planned ${planned} update(s) (dry run; pass --apply to write).`}`,
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
