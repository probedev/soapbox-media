/**
 * Channel seed loader.
 *
 * Reads the locked v2 channel list from src/data/channels.ts, resolves
 * placeholder platform IDs to real platform IDs via YouTube Data API and
 * PodScan, pulls live reach numbers where available, and upserts into the
 * Supabase `channels` table.
 *
 * Run with: npm run seed:channels
 *
 * Idempotent — re-running updates existing rows (uses unique constraint
 * on platform + platform_id).
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { SEED_CHANNELS, type SeedChannel } from "@/data/channels";
import { resolveChannelByHandle } from "@/lib/youtube";
import { searchPodcasts } from "@/lib/podscan";

interface SeedResult {
  channel: string;
  platform: "youtube" | "podcast";
  status: "ok" | "skipped" | "failed";
  detail: string;
}

async function seedYouTube(seed: SeedChannel, db: ReturnType<typeof createServiceClient>): Promise<SeedResult> {
  if (!seed.youtubeHandle) {
    return { channel: seed.name, platform: "youtube", status: "skipped", detail: "no handle" };
  }
  try {
    const info = await resolveChannelByHandle(seed.youtubeHandle);
    if (!info) {
      return { channel: seed.name, platform: "youtube", status: "failed", detail: `channel not found for ${seed.youtubeHandle}` };
    }
    const { error } = await db.from("channels").upsert(
      {
        name: seed.name,
        platform: "youtube",
        platform_id: info.id,
        political_lean: seed.lean,
        reach: info.subscriberCount,
        active: true,
        classification_rationale: seed.rationale,
      },
      { onConflict: "platform,platform_id" },
    );
    if (error) {
      return { channel: seed.name, platform: "youtube", status: "failed", detail: error.message };
    }
    return {
      channel: seed.name,
      platform: "youtube",
      status: "ok",
      detail: `${info.id} (${info.subscriberCount.toLocaleString()} subs)`,
    };
  } catch (e: any) {
    return { channel: seed.name, platform: "youtube", status: "failed", detail: e.message };
  }
}

async function seedPodcast(seed: SeedChannel, db: ReturnType<typeof createServiceClient>): Promise<SeedResult> {
  if (!seed.podcastSearchName) {
    return { channel: seed.name, platform: "podcast", status: "skipped", detail: "no search name" };
  }
  try {
    const results = await searchPodcasts(seed.podcastSearchName);
    if (results.length === 0) {
      return { channel: seed.name, platform: "podcast", status: "failed", detail: `no PodScan results for "${seed.podcastSearchName}"` };
    }
    const top = results[0];

    // PodScan uses different ID/title field names depending on endpoint version.
    // Try common variants; if none match, surface the keys we did see so we can patch.
    const platformId =
      top.id || top.podcast_id || top.uuid || top.slug || top.pscid;
    const podcastTitle =
      top.title || top.name || top.podcast_name || seed.name;

    if (!platformId) {
      const keys = Object.keys(top).join(", ");
      return {
        channel: seed.name,
        platform: "podcast",
        status: "failed",
        detail: `PodScan result has no recognized ID field. Available keys: [${keys}]`,
      };
    }

    const { error } = await db.from("channels").upsert(
      {
        name: seed.name,
        platform: "podcast",
        platform_id: platformId,
        political_lean: seed.lean,
        reach: seed.reachEstimate,
        active: true,
        classification_rationale: seed.rationale,
      },
      { onConflict: "platform,platform_id" },
    );
    if (error) {
      return { channel: seed.name, platform: "podcast", status: "failed", detail: error.message };
    }
    return {
      channel: seed.name,
      platform: "podcast",
      status: "ok",
      detail: `${platformId} ("${podcastTitle}")`,
    };
  } catch (e: any) {
    return { channel: seed.name, platform: "podcast", status: "failed", detail: e.message };
  }
}

async function main() {
  console.log(`\nSoapbox channel seed loader\n${"─".repeat(60)}`);
  console.log(`Processing ${SEED_CHANNELS.length} channels from src/data/channels.ts\n`);

  const db = createServiceClient();
  const results: SeedResult[] = [];

  for (const seed of SEED_CHANNELS) {
    const tasks: Promise<SeedResult>[] = [];
    if (seed.youtubeHandle) tasks.push(seedYouTube(seed, db));
    if (seed.podcastSearchName) tasks.push(seedPodcast(seed, db));
    const channelResults = await Promise.all(tasks);
    results.push(...channelResults);

    const leanLabel = seed.lean.padEnd(1);
    console.log(`[${leanLabel}] ${seed.name}`);
    for (const r of channelResults) {
      const icon = r.status === "ok" ? "✓" : r.status === "skipped" ? "○" : "✗";
      console.log(`    ${icon} ${r.platform.padEnd(7)} ${r.detail}`);
    }
  }

  // Summary
  const ok = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Summary: ${ok} succeeded, ${skipped} skipped, ${failed} failed`);

  // Verify total in DB
  const { count } = await db.from("channels").select("*", { count: "exact", head: true });
  console.log(`Channels table now contains: ${count} rows`);

  if (failed > 0) {
    console.log(`\nFailures (likely PodScan field-name mismatches or YT handle drift):`);
    for (const r of results.filter((r) => r.status === "failed")) {
      console.log(`  - ${r.channel} [${r.platform}]: ${r.detail}`);
    }
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
