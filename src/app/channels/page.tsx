import { createServiceClient } from "@/lib/db";
import { PUBLIC_COHORTS } from "@/lib/cohort";
import { CohortBadge } from "@/components/CohortBadge";
import { CohortLegend } from "@/components/CohortLegend";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PanelBalance } from "@/components/PanelBalance";
import { PanelScale } from "@/components/PanelScale";
import { getChannelExternalUrl } from "@/lib/channelLinks";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

function leanBadge(lean: "L" | "M" | "R"): string {
  switch (lean) {
    case "L":
      return "bg-blue-100 text-blue-800";
    case "R":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

interface ChannelRow {
  id: string;
  name: string;
  platform: "youtube" | "podcast";
  platform_id: string;
  political_lean: "L" | "M" | "R";
  reach: number | bigint;
  classification_rationale: string | null;
  cohort: "independent" | "legacy";
}

interface PlatformRef {
  platform: "youtube" | "podcast";
  channel_id: string;
  platform_id: string;
  reach: number;
}

interface ShowRow {
  /** UUID of the canonical channel row (podcast preferred when both exist) */
  canonical_id: string;
  name: string;
  political_lean: "L" | "M" | "R";
  platforms: PlatformRef[];
  maxReach: number;
  classification_rationale: string | null;
  cohort: "independent" | "legacy";
}

/**
 * Collapse same-name channel rows (e.g. Ben Shapiro Podcast + Ben Shapiro
 * YouTube) into one show. Backend keeps separate rows per (show, platform)
 * for ingest reasons; UI treats each show as one entity.
 */
function groupByShow(rows: ChannelRow[]): ShowRow[] {
  const byName = new Map<string, ChannelRow[]>();
  for (const r of rows) {
    const arr = byName.get(r.name) || [];
    arr.push(r);
    byName.set(r.name, arr);
  }

  const shows: ShowRow[] = [];
  for (const [name, group] of byName) {
    const canonical = group.find((g) => g.platform === "podcast") || group[0];
    const platforms: PlatformRef[] = group.map((g) => ({
      platform: g.platform,
      channel_id: g.id,
      platform_id: g.platform_id,
      reach: Number(g.reach) || 0,
    }));
    const maxReach = Math.max(...platforms.map((p) => p.reach));
    shows.push({
      canonical_id: canonical.id,
      name,
      political_lean: canonical.political_lean,
      platforms,
      maxReach,
      classification_rationale: canonical.classification_rationale,
      cohort: canonical.cohort,
    });
  }
  return shows.sort((a, b) => b.maxReach - a.maxReach);
}

function platformAbbrev(p: "youtube" | "podcast"): string {
  return p === "youtube" ? "YT" : "Pod";
}

export default async function ChannelsListPage() {
  const db = createServiceClient();
  // Paginate by `id` (stable PK) and terminate only on an empty page — see
  // [[pagination-stable-order]]. A single `.range(0, 999)` silently truncates
  // at 1000 active channels, which the panel will cross on the path to ~200
  // unique shows (2-3 platform rows each) and definitely past that. JS
  // re-sorts via groupByShow → maxReach, so SQL order doesn't affect the UI.
  const rows: ChannelRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("channels")
      .select(
        "id, name, platform, platform_id, political_lean, reach, classification_rationale, cohort",
      )
      .eq("active", true)
      .in("cohort", [...PUBLIC_COHORTS])
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as ChannelRow[]));
  }
  const shows = groupByShow(rows);

  const byLean = {
    L: shows.filter((s) => s.political_lean === "L"),
    M: shows.filter((s) => s.political_lean === "M"),
    R: shows.filter((s) => s.political_lean === "R"),
  };

  return (
    <main className="min-h-screen">
      <Header activePage="channels" />

      <section className="px-6 pt-10 pb-16 max-w-5xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">
            ← Soapbox Index
          </a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Channels we track
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          {shows.length} hand-curated alt-media political shows, balanced across
          Left, Middle, and Right publishing posture. YouTube subscriber counts
          refresh daily during the ingest pass; podcast audience estimates are
          editorial and reviewed at panel-add time. Lean classifications are
          editorial and reviewed quarterly. See the{" "}
          <a href="/methodology" className="underline hover:text-gray-900">
            methodology page
          </a>{" "}
          for selection criteria, or the{" "}
          <a href="/log" className="underline hover:text-gray-900">
            pipeline log
          </a>{" "}
          for system scale and daily health.
        </p>

        {/* Magnitude first (PanelScale), distribution second (PanelBalance),
            list third (per-lean grid). This matches the reader's natural
            question order on /channels: "how big is this panel?" → "how is
            it split?" → "show me the shows." Pipeline-side numbers live on
            /log under <SystemStats>; the two cards intentionally don't
            overlap. */}
        <PanelScale />
        <PanelBalance shows={shows} />

        {PUBLIC_COHORTS.length > 1 && (
          <div className="flex justify-end mt-6">
            <CohortLegend />
          </div>
        )}

        {(["L", "M", "R"] as const).map((bucket) => (
          <section key={bucket} className="mt-10">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold">
                {bucket === "L"
                  ? "Left-leaning"
                  : bucket === "R"
                  ? "Right-leaning"
                  : "Middle / cross-cutting"}{" "}
                <span className="text-gray-400 text-sm font-normal">
                  ({byLean[bucket].length})
                </span>
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byLean[bucket].map((show) => {
                const platformText = show.platforms
                  .map((p) => platformAbbrev(p.platform))
                  .join(" · ");
                return (
                  <div
                    key={show.name}
                    className="relative border border-gray-200 bg-white rounded-lg hover:border-gray-400 hover:shadow-sm transition group"
                  >
                    <a
                      href={`/channels/${show.canonical_id}`}
                      className="block p-4 pr-20"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanBadge(show.political_lean)}`}
                          >
                            {show.political_lean}
                          </span>
                          {PUBLIC_COHORTS.length > 1 && (
                            <CohortBadge cohort={show.cohort} />
                          )}
                          {show.name}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 tabular-nums">
                        Reach: {show.maxReach.toLocaleString()}
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-400">
                          {platformText}
                        </span>
                      </div>
                      {show.classification_rationale && (
                        <div className="text-xs text-gray-600 mt-2 leading-snug line-clamp-2">
                          {show.classification_rationale}
                        </div>
                      )}
                    </a>
                    {/* One external-link icon per platform we track for this show */}
                    <div className="absolute top-3 right-3 flex items-center gap-0.5">
                      {show.platforms.map((p) => {
                        const ext = getChannelExternalUrl({
                          platform: p.platform,
                          platform_id: p.platform_id,
                          name: show.name,
                        });
                        return (
                          <a
                            key={p.platform}
                            href={ext.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${ext.label} (${platformAbbrev(p.platform)})`}
                            title={`${ext.label} (${platformAbbrev(p.platform)})`}
                            className="inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-900 px-1 py-1 opacity-60 group-hover:opacity-100 transition"
                          >
                            <span className="text-[9px] font-semibold uppercase tracking-wider">
                              {platformAbbrev(p.platform)}
                            </span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </section>

      <Footer />
    </main>
  );
}
