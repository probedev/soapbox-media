import { SoapboxNeedle } from "@/components/SoapboxNeedle";
import { IssuePreview } from "@/components/IssuePreview";
import { IndexSparkline } from "@/components/IndexSparkline";
import { WeeklyHeadline } from "@/components/WeeklyHeadline";
import { BiggestMovers } from "@/components/BiggestMovers";
import { TrustStrip } from "@/components/TrustStrip";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getDashboardData, getIndexBreakdown, buildAutoHeadline } from "@/lib/aggregate";

// Always recompute on request so the daily-cron pipeline is reflected immediately.
// v1 will move this to cached SQL views / materialized aggregates.
export const dynamic = "force-dynamic";

function formatAsOfLabel(asOfDateIso: string, windowDays: number): string {
  const d = new Date(asOfDateIso);
  const formatted = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Last ${windowDays} days · as of ${formatted}`;
}

export default async function HomePage() {
  // Pull dashboard data (7-day rolling window) and the contribution breakdown
  // in parallel. The breakdown drives the auto-generated narrative headline,
  // so we compute it over the same 7-day window as the headline number.
  const HOMEPAGE_WINDOW_DAYS = 7;
  const [data, breakdown] = await Promise.all([
    getDashboardData(HOMEPAGE_WINDOW_DAYS),
    getIndexBreakdown(HOMEPAGE_WINDOW_DAYS),
  ]);
  const autoHeadline = buildAutoHeadline(breakdown);

  const directionLabel = data.index >= 0 ? "R+" : "L+";
  const directionWord = data.index >= 0 ? "right" : "left";
  const indexColor = data.index >= 0 ? "text-red-600" : "text-blue-600";
  const deltaPositive = data.delta >= 0;
  const asOfLabel = data.hasData
    ? formatAsOfLabel(data.asOfDate, data.windowDays)
    : "No data yet";

  return (
    <main className="min-h-screen">
      <Header />

      {/* Hero — needle + headline number + sparkline + trust strip */}
      <section className="px-6 pt-12 pb-10 max-w-5xl mx-auto text-center">
        <div className="uppercase text-xs font-semibold tracking-wider text-gray-500 mb-2">
          The Soapbox Index · updated daily
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Where is alt-media leaning right now?
        </h1>
        <p className="text-gray-600 mt-3 max-w-2xl mx-auto leading-relaxed">
          The epicenter of US political discourse has moved from cable and talk radio to
          podcasts and YouTube, shaping opinions, elections, and policy. These independent
          voices have never been measured at scale. Soapbox listens above your personal
          algorithms to ask: where are they leading us?
        </p>

        <div className="mt-10 flex justify-center">
          <SoapboxNeedle value={data.index} />
        </div>

        <div className="mt-2">
          <div className={`text-7xl font-semibold tracking-tight tabular-nums ${indexColor}`}>
            {directionLabel}
            {Math.abs(data.index).toFixed(1)}
          </div>
          <div className="text-sm text-gray-600 mt-3">
            {data.hasData ? (
              <>
                Alt-media is leaning <span className="font-medium">{directionWord}</span> over the last {data.windowDays} days.{" "}
                {Math.abs(data.delta) > 0 && (
                  <>
                    <span
                      className={`font-semibold tabular-nums ${deltaPositive ? "text-red-600" : "text-blue-600"}`}
                    >
                      {deltaPositive ? "↑" : "↓"} {Math.abs(data.delta).toFixed(1)}
                    </span>{" "}
                    vs the prior {data.windowDays} days
                  </>
                )}
                {Math.abs(data.delta) === 0 && data.sparkline.length < 2 && (
                  <span className="text-gray-400">
                    (period-over-period comparison available once we have a second window of data)
                  </span>
                )}
              </>
            ) : (
              <span className="text-gray-400">
                Pipeline online. Waiting for first sentiment scores.
              </span>
            )}
          </div>
        </div>

        {data.sparkline.length >= 2 && (
          <div className="mt-6 flex flex-col items-center gap-1">
            <IndexSparkline values={data.sparkline} />
            <div className="text-[10px] uppercase tracking-wider text-gray-400">
              {data.sparkline.length}-day history · rolling {data.windowDays}-day Index
            </div>
          </div>
        )}

        <div className="mt-8">
          <TrustStrip
            numChannels={data.numChannels}
            numEpisodes={data.numEpisodes}
            lastUpdated={data.lastUpdated}
            asOfLabel={asOfLabel}
            isPlaceholder={!data.hasData}
          />
        </div>
      </section>

      {/* Period summary */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="uppercase text-xs font-semibold tracking-wider text-gray-500 mb-3 text-center">
            What&apos;s driving today&apos;s Index
          </div>
          <WeeklyHeadline
            text={autoHeadline || undefined}
            href="/methodology#why-is-the-index"
          />
        </div>
      </section>

      {/* Biggest movers */}
      {data.movers.length > 0 && (
        <section className="border-t border-gray-200 bg-white">
          <div className="max-w-3xl mx-auto px-6 py-12">
            <BiggestMovers movers={data.movers.slice(0, 5)} />
          </div>
        </section>
      )}

      {/* Top issues */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-lg font-semibold">
              {data.hasData ? `Top issues · last ${data.windowDays} days` : "Top issues"}
            </h2>
            <a href="/issues" className="text-sm text-gray-600 hover:text-gray-900">
              All issues →
            </a>
          </div>
          {data.issues.length === 0 ? (
            <div className="text-sm text-gray-500 italic">
              No issue classifications yet. Run the classify + score pipeline to populate.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.issues.slice(0, 6).map((issue) => (
                <IssuePreview
                  key={issue.slug}
                  slug={issue.slug}
                  name={issue.name}
                  lean={issue.lean}
                  volume={issue.volume}
                  trend={issue.trend}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
