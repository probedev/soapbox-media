/**
 * Transcript fetcher.
 *
 * For each episode in the DB with transcript_status = 'pending', pull a
 * transcript using the right provider for its channel platform:
 *  - YouTube: youtube-transcript library (auto-caption scrape)
 *  - Podcast: PodScan episode detail (defensive fallback — podcasts should
 *    already have transcripts written inline during ingest)
 *
 * Writes to transcripts table, updates episode.transcript_status to 'fetched'
 * or 'failed' on completion.
 *
 * Run with:  npm run transcribe
 * Override:  npm run transcribe -- <limit>
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getVideoTranscript } from "@/lib/youtube";

interface PendingEpisode {
  id: string;
  channel_id: string;
  title: string;
  source_url: string;
  channel: {
    name: string;
    platform: "youtube" | "podcast";
    political_lean: "L" | "M" | "R";
  };
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v");
    }
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace(/^\//, "");
    }
  } catch {
    // malformed URL
  }
  return null;
}

async function transcribeYouTube(
  episode: PendingEpisode,
  db: ReturnType<typeof createServiceClient>,
): Promise<{ ok: boolean; detail: string }> {
  const videoId = extractYouTubeVideoId(episode.source_url);
  if (!videoId) {
    await db
      .from("episodes")
      .update({ transcript_status: "failed" })
      .eq("id", episode.id);
    return { ok: false, detail: `could not extract video ID from ${episode.source_url}` };
  }

  const transcript = await getVideoTranscript(videoId);
  if (!transcript || transcript.trim().length === 0) {
    await db
      .from("episodes")
      .update({ transcript_status: "failed" })
      .eq("id", episode.id);
    return { ok: false, detail: `no captions available for ${videoId}` };
  }

  const { error: txErr } = await db.from("transcripts").upsert(
    {
      episode_id: episode.id,
      text: transcript,
      provider: "youtube_captions",
    },
    { onConflict: "episode_id", ignoreDuplicates: false },
  );
  if (txErr) {
    return { ok: false, detail: `upsert transcript: ${txErr.message}` };
  }

  await db
    .from("episodes")
    .update({ transcript_status: "fetched" })
    .eq("id", episode.id);

  const wordCount = transcript.trim().split(/\s+/).length;
  return { ok: true, detail: `${wordCount.toLocaleString()} words` };
}

async function main() {
  const limit = parseInt(process.argv[2] || "20", 10);

  console.log(`\nSoapbox transcript fetcher`);
  console.log(`─`.repeat(60));
  console.log(`Processing up to ${limit} pending episodes\n`);

  const db = createServiceClient();
  const { data: pending, error } = await db
    .from("episodes")
    .select(
      `
      id, channel_id, title, source_url,
      channel:channels!episodes_channel_id_fkey (
        name, platform, political_lean
      )
    `,
    )
    .eq("transcript_status", "pending")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to load pending episodes:", error.message);
    process.exit(1);
  }
  if (!pending || pending.length === 0) {
    console.log("No pending episodes. Run `npm run ingest` to discover more.");
    return;
  }

  console.log(`Found ${pending.length} pending episodes\n`);

  let ok = 0;
  let failed = 0;

  for (const row of pending as unknown as PendingEpisode[]) {
    const truncatedTitle = row.title.slice(0, 80);
    console.log(
      `[${row.channel.political_lean}] ${row.channel.name} (${row.channel.platform})`,
    );
    console.log(`    ${truncatedTitle}`);

    let result: { ok: boolean; detail: string };
    if (row.channel.platform === "youtube") {
      result = await transcribeYouTube(row, db);
    } else {
      // Podcast row sitting in pending — shouldn't happen often since ingest
      // writes transcripts inline. Mark as failed and surface for follow-up.
      await db
        .from("episodes")
        .update({ transcript_status: "failed" })
        .eq("id", row.id);
      result = {
        ok: false,
        detail: "podcast transcript missing at ingest — PodScan likely still processing",
      };
    }

    if (result.ok) {
      console.log(`    ✓ ${result.detail}`);
      ok += 1;
    } else {
      console.log(`    ✗ ${result.detail}`);
      failed += 1;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Result: ${ok} transcribed, ${failed} failed`);

  const { count: txCount } = await db
    .from("transcripts")
    .select("*", { count: "exact", head: true });
  const { count: pendingCount } = await db
    .from("episodes")
    .select("*", { count: "exact", head: true })
    .eq("transcript_status", "pending");
  console.log(
    `Transcripts table: ${txCount} rows. Episodes still pending: ${pendingCount}.`,
  );
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
