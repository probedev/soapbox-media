import { SoapboxNeedle } from "@/components/SoapboxNeedle";
import { IssuePreview } from "@/components/IssuePreview";
import { IndexAreaChart } from "@/components/IndexAreaChart";
import { IssueContributionsChart } from "@/components/IssueContributionsChart";
import { BiggestMovers } from "@/components/BiggestMovers";
import { TrustStrip } from "@/components/TrustStrip";
import { TrendingNames } from "@/components/TrendingNames";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getDashboardData, getIndexBreakdown, readHomeSnapshot } from "@/lib/aggregate";
import { readTrending } from "@/lib/trending";
import { SubNeedle } from "@/components/SubNeedle";
import { PUBLIC_COHORTS } from "@/lib/cohort";

// The home page reads a precomputed snapshot (written at the end of the score
// cron) so it serves one light row instead of re-aggregating the full
// sentiment_scores join per request. Kept `force-dynamic` so it always reflects
// the latest snapshot the moment the cron refreshes it — reading one indexed
// row is sub-100ms. Falls back to a live computation only when the snapshot is
// missing or unavailable (first deploy / before first cron / pre-migration).
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
  // Pull dashboard data for the 7-day rolling window. The IssueContributionsChart
  // below fetches its own breakdown over the same window, so the "Why is the
  // Index where it is?" narrative aligns with the headline number above.
  const HOMEPAGE_WINDOW_DAYS = 7;
  // Prefer the precomputed snapshot. `.catch(() => null)` keeps the page alive
  // if the dashboard_snapshot table doesn't exist yet (migration not applied)
  // or the read errors — we just fall back to the live (slower) path.
  const snapshot = await readHomeSnapshot(HOMEPAGE_WINDOW_DAYS).catch(() => null);
  const data = snapshot?.dashboard ?? (await getDashboardData(HOMEPAGE_WINDOW_DAYS));
  // Breakdown for <IssueContributionsChart>. From the snapshot when present;
  // otherwise the component computes it live itself (prop left undefined).
  const breakdown =
    snapshot?.breakdown ?? (await getIndexBreakdown(HOMEPAGE_WINDOW_DAYS));
  // Trending Names (BETA) — its own snapshot, refreshed by /api/cron/trending.
  // Best-effort: a missing/failed read must not break the home page.
  const trending = await readTrending().catch(() => null);

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
          Where is online political media leaning right now?
        </h1>
        <p className="text-gray-600 mt-3 max-w-2xl mx-auto leading-relaxed">
          Soapbox uses language models to quantify what political media on YouTube and
          podcasts says about US policy issues, and how{" "}
          <span className="font-medium">independent creators</span> and{" "}
          <span className="font-medium">legacy media</span> differ. New episodes
          processed daily.
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
                Online political media is leaning <span className="font-medium">{directionWord}</span> over the last {data.windowDays} days.{" "}
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

        {PUBLIC_COHORTS.length > 1 && snapshot?.cohorts && (
          <div className="mt-8">
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-3">
              Independent vs Legacy
            </div>
            <div className="grid grid-cols-2 gap-6 max-w-sm mx-auto">
              <SubNeedle
                label="Independent"
                value={snapshot.cohorts.independent.index}
                hasData={snapshot.cohorts.independent.hasData}
              />
              <SubNeedle
                label="Legacy"
                value={snapshot.cohorts.legacy.index}
                hasData={snapshot.cohorts.legacy.hasData}
              />
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Independent creators vs legacy media, same issues, same scoring.
            </p>
          </div>
        )}

        {data.sparkline.length >= 2 && (
          <div className="mt-6 flex flex-col items-center">
            <IndexAreaChart
              values={data.sparkline}
              dates={data.sparklineDates}
              windowDays={data.windowDays}
            />
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

      {/* Why is the Index where it is? — per-issue contribution breakdown */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <IssueContributionsChart windowDays={HOMEPAGE_WINDOW_DAYS} breakdown={breakdown} />
        </div>
      </section>

      {/* Biggest movers */}
      {data.movers.length > 0 && (
        <section className="border-t border-gray-200 bg-white">
          <div className="max-w-3xl mx-auto px-6 py-12">
            {/* Cap (and ranking) live in getDashboardData so every consumer
                of `data.movers` agrees on the leaderboard length. */}
            <BiggestMovers movers={data.movers} />
          </div>
        </section>
      )}

      {/* Trending Names (BETA) — named-entity burst tease */}
      {trending && trending.entities.length > 0 && (
        <section className="border-t border-gray-200 bg-white">
          <div className="max-w-3xl mx-auto px-6 py-12">
            <TrendingNames data={trending} />
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
