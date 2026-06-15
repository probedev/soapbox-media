import { getChannelDrillDown } from "@/lib/aggregate";
import { getChannelExternalUrl } from "@/lib/channelLinks";
import { Card } from "@/components/ui/card";
import { createServiceClient } from "@/lib/db";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { IndexAreaChart } from "@/components/IndexAreaChart";
import { EpisodeDataTable } from "@/components/EpisodeDataTable";
import { ChannelIssueBreakdown } from "@/components/ChannelIssueBreakdown";
import { getEpisodeTableRows } from "@/lib/episodes";
import { leanColor, leanChipStyle } from "@/lib/lean";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

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

  // Episodes for this channel - same sortable/searchable table as /log,
  // minus the redundant Category + Channel columns.
  const episodeRows = await getEpisodeTableRows(1000, params.id);

  const markerPct = ((data.netLean + 10) / 20) * 100;
  const directionLabel = data.netLean >= 0 ? "R+" : "L+";

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-8 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-3">
          <a href="/" className="hover:text-ink-body">← Soapbox Index</a>
          <span aria-hidden className="text-ink-faint">·</span>
          <a href="/channels" className="hover:text-ink-body">All channels</a>
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{data.channel_name}</h1>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded ${leanChipStyle(data.channel_lean).cls}`}
          >
            {leanLabelWord(data.channel_lean)}
          </span>
        </div>
        <div className="text-sm text-ink-muted mt-2 tabular-nums flex items-center gap-4 flex-wrap">
          <span>Reach: {data.channel_reach.toLocaleString()}</span>
          {ext && ext.url !== "#" && (
            <a
              href={ext.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 border border-input rounded-md text-xs font-medium text-ink-body hover:bg-subtle hover:border-ink-faint transition"
            >
              {ext.label}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Net lean */}
        <Card className="mt-8 p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Net Soapbox Score across all issues (last 30 days)
          </div>
          <div className="flex items-baseline gap-4">
            <div className={`text-5xl font-semibold tabular-nums ${leanColor(data.netLean)}`}>
              {directionLabel}
              {Math.abs(data.netLean).toFixed(1)}
            </div>
            <div className="text-sm text-muted-foreground">
              {data.numClassifications.toLocaleString()} mentions across {data.numEpisodes} episodes
            </div>
          </div>
          <div className="mt-5 relative h-2 rounded-full bg-gradient-to-r from-blue-500 via-gray-200 to-red-500 max-w-md">
            <div
              className="absolute top-1/2 w-3 h-3 rounded-full bg-primary border-2 border-white shadow"
              style={{ left: `${markerPct}%`, transform: "translate(-50%, -50%)" }}
            />
          </div>

          {data.trend.values.length >= 2 && (
            <div className="mt-6 pt-6 border-t border-muted">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                How this channel has trended
              </div>
              <IndexAreaChart
                values={data.trend.values}
                dates={data.trend.dates}
                maxWidthClass=""
                includeZero={false}
              />
            </div>
          )}
        </Card>
      </section>

      {/* Issue breakdown */}
      <section className="border-t border-border bg-subtle">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">Issues this channel has covered</h2>
            <span className="text-xs text-muted-foreground">last 30 days, sorted by volume</span>
          </div>
          {data.issues.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              No classifications for this channel yet.
            </div>
          ) : (
            <ChannelIssueBreakdown channelId={params.id} issues={data.issues} />
          )}
        </div>
      </section>

      {/* Recent episodes - transparency surface, links out to original sources */}
      <section className="border-t border-border bg-card">
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
