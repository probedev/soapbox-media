/**
 * Server-paginated episode table feed for /log (and channel drill-downs).
 * Sorting, search, and pagination happen in Postgres so the client fetches
 * only the page it renders - TTFB stays flat as the archive grows instead of
 * shipping all ~2,000+ rows per request.
 *
 * Public, read-only data; served via the service-role client like the rest of
 * the app's reads.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getEpisodeTablePage, type EpisodeSortKey } from "@/lib/episodes";

export const dynamic = "force-dynamic";

const VALID_SORTS: ReadonlySet<string> = new Set<EpisodeSortKey>([
  "published_at",
  "title",
  "channel_name",
  "duration_sec",
  "political_lean",
  "platform",
  "transcript_status",
  "classify_status",
  "scored_count",
]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sortRaw = sp.get("sort") || "published_at";
  const sort = (VALID_SORTS.has(sortRaw) ? sortRaw : "published_at") as EpisodeSortKey;
  const page = Math.max(0, parseInt(sp.get("page") || "0", 10) || 0);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "50", 10) || 50));

  try {
    const result = await getEpisodeTablePage({
      channelId: sp.get("channelId") || undefined,
      q: sp.get("q") || undefined,
      sort,
      dir: sp.get("dir") === "asc" ? "asc" : "desc",
      page,
      pageSize,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "query failed" }, { status: 500 });
  }
}
