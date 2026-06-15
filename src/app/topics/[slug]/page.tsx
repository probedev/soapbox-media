import { getTopicDrillDown } from "@/lib/aggregate";
import { Card } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { IndexAreaChart } from "@/components/IndexAreaChart";
import { formatLean, leanColor } from "@/lib/lean";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TopicPage({ params }: { params: { slug: string } }) {
  const data = await getTopicDrillDown(params.slug);
  if (!data) notFound();

  const markerPct = ((data.overallLean + 10) / 20) * 100;
  const directionLabel = data.overallLean >= 0 ? "R+" : "L+";

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-8 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          <a href="/issues" className="hover:text-ink-body">← Issue taxonomy</a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{data.name}</h1>
        <p className="text-ink-muted mt-3 leading-relaxed max-w-3xl">{data.description}</p>

        {/* Overall topic lean */}
        <Card className="mt-8 p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Soapbox Score on this topic (last 30 days)
          </div>
          <div className="flex items-baseline gap-4">
            <div className={`text-5xl font-semibold tabular-nums ${leanColor(data.overallLean)}`}>
              {directionLabel}
              {Math.abs(data.overallLean).toFixed(1)}
            </div>
            <div className="text-sm text-muted-foreground">
              {data.numClassifications.toLocaleString()} mentions across {data.numEpisodes} episodes,
              over {data.issues.length} issue{data.issues.length === 1 ? "" : "s"}
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
                How this topic has trended
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

      {/* Child issues */}
      <section className="border-t border-border bg-subtle">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">Issues in this topic</h2>
            <span className="text-xs text-muted-foreground">last 30 days, sorted by share of voice</span>
          </div>
          {data.issues.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              No classifications for this topic yet.
            </div>
          ) : (
            <Card className="divide-y divide-border">
              {data.issues.map((i) => {
                const pct = ((i.lean + 10) / 20) * 100;
                return (
                  <a
                    key={i.issue_slug}
                    href={`/issues/${i.issue_slug}`}
                    className="block px-4 py-3 hover:bg-subtle transition"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium truncate">{i.issue_name}</span>
                      <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${leanColor(i.lean)}`}>
                        {formatLean(i.lean)}
                      </span>
                    </div>
                    <div className="mt-2 relative h-1.5 rounded-full bg-gradient-to-r from-blue-500 via-gray-200 to-red-500">
                      <div
                        className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-primary border-2 border-white"
                        style={{ left: `${pct}%`, transform: "translate(-50%, -50%)" }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                      {i.numMentions} mentions · share-of-voice weight {i.weight.toLocaleString()}
                    </div>
                  </a>
                );
              })}
            </Card>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
