import { getChannelDrillDown } from "@/lib/aggregate";
import { getChannelExternalUrl } from "@/lib/channelLinks";
import { createServiceClient } from "@/lib/db";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { EpisodeDataTable } from "@/components/EpisodeDataTable";
import { getEpisodeTableRows } from "@/lib/episodes";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

function formatLean(v: number): string {
  if (v > 0.05) return `R+${v.toFixed(1)}`;
  if (v < -0.05) return `L+${Math.abs(v).toFixed(1)}`;
  return "0.0";
}

function leanColor(v: number): string {
  if (v > 0.05) return "text-red-600";
  if (v < -0.05) return "text-blue-600";
  return "text-gray-700";
}

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

function leanLabelWord(lean: "L" | "M" | "R"): string {
  return lean === "L" ? "Left-leaning" : lean === "R" ? "Right-leaning" : "Middle / cross-cutting";
}

export default async function ChannelPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getChannelDrillDown(params.id);
  if (!data) notFound();

  // Fetch the channel's platform info for the external link
  const db = createServiceClient();
  const { data: channelMeta } = await db
    .from("channels")
    .select("platform, platform_id, name")
    .eq("id", params.id)
    .single();
  const ext = channelMeta
    ? getChannelExternalUrl({
        platform: channelMeta.platform,
        platform_id: channelMeta.platform_id,
        name: channelMeta.name,
      })
    : null;

  // Episodes for this channel — same sortable/searchable table as /log,
  // minus the redundant Category + Channel columns.
  const episodeRows = await getEpisodeTableRows(1000, params.id);

  const markerPct = ((data.netLean + 10) / 20) * 100;
  const directionLabel = data.netLean >= 0 ? "R+" : "L+";

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-8 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-3">
          <a href="/" className="hover:text-gray-700">← Soapbox Index</a>
          <span aria-hidden className="text-gray-400">·</span>
          <a href="/channels" className="hover:text-gray-700">All channels</a>
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{data.channel_name}</h1>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded ${leanBadge(data.channel_lean)}`}
          >
            {leanLabelWord(data.channel_lean)}
          </span>
        </div>
        <div className="text-sm text-gray-600 mt-2 tabular-nums flex items-center gap-4 flex-wrap">
          <span>Reach: {data.channel_reach.toLocaleString()}</span>
          {ext && ext.url !== "#" && (
            <a
              href={ext.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 border border-gray-300 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition"
            >
              {ext.label}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Net lean */}
        <div className="mt-8 border border-gray-200 rounded-lg p-6 bg-white">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Net Soapbox Score across all issues (last 30 days)
          </div>
          <div className="flex items-baseline gap-4">
            <div className={`text-5xl font-semibold tabular-nums ${leanColor(data.netLean)}`}>
              {directionLabel}
              {Math.abs(data.netLean).toFixed(1)}
            </div>
            <div className="text-sm text-gray-500">
              {data.numClassifications.toLocaleString()} mentions across {data.numEpisodes} episodes
            </div>
          </div>
          <div className="mt-5 relative h-2 rounded-full bg-gradient-to-r from-blue-500 via-gray-200 to-red-500 max-w-md">
            <div
              className="absolute top-1/2 w-3 h-3 rounded-full bg-gray-900 border-2 border-white shadow"
              style={{ left: `${markerPct}%`, transform: "translate(-50%, -50%)" }}
            />
          </div>
        </div>
      </section>

      {/* Issue breakdown */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">Issues this channel has covered</h2>
            <span className="text-xs text-gray-500">last 30 days, sorted by volume</span>
          </div>
          {data.issues.length === 0 ? (
            <div className="text-sm text-gray-500 italic">
              No classifications for this channel yet.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
              {data.issues.map((issue) => {
                const pct = ((issue.lean + 10) / 20) * 100;
                return (
                  <a
                    key={issue.issue_slug}
                    href={`/issues/${issue.issue_slug}`}
                    className="block px-4 py-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{issue.issue_name}</span>
                      <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${leanColor(issue.lean)}`}>
                        {formatLean(issue.lean)}
                      </span>
                    </div>
                    <div className="mt-2 relative h-1.5 rounded-full bg-gradient-to-r from-blue-500 via-gray-200 to-red-500">
                      <div
                        className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-gray-900 border-2 border-white"
                        style={{ left: `${pct}%`, transform: "translate(-50%, -50%)" }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-1.5 tabular-nums">
                      {issue.numMentions} mentions · weight {issue.weight.toLocaleString()}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Recent episodes — transparency surface, links out to original sources */}
      <section className="border-t border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent episodes</h2>
          </div>
          <EpisodeDataTable data={episodeRows} hideChannelColumns />
        </div>
      </section>

      <Footer />
    </main>
  );
}
