import { getIssueDrillDown } from "@/lib/aggregate";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { IndexAreaChart } from "@/components/IndexAreaChart";
import { notFound } from "next/navigation";

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

export default async function IssuePage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await getIssueDrillDown(params.slug);
  if (!data) notFound();

  const markerPct = ((data.overallLean + 10) / 20) * 100;
  const directionLabel = data.overallLean >= 0 ? "R+" : "L+";

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-8 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">← Soapbox Index</a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{data.name}</h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">{data.definition}</p>

        {/* Overall lean */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-6 border border-gray-200 rounded-lg p-6 bg-white">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              Soapbox Score on this issue (last 30 days)
            </div>
            <div className="flex items-baseline gap-4">
              <div className={`text-5xl font-semibold tabular-nums ${leanColor(data.overallLean)}`}>
                {directionLabel}
                {Math.abs(data.overallLean).toFixed(1)}
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
        </div>

        {/* Trend */}
        {data.trend.values.length >= 2 && (
          <div className="mt-6 border border-gray-200 rounded-lg p-6 bg-white">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-3">
              How this issue has trended
            </div>
            <IndexAreaChart values={data.trend.values} dates={data.trend.dates} />
          </div>
        )}

        {/* L/R positions */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-4">
            <div className="text-xs uppercase tracking-wider text-blue-700 font-semibold mb-1">
              Left-leaning position
            </div>
            <div className="text-sm text-gray-800">{data.leftPosition}</div>
          </div>
          <div className="border border-red-200 bg-red-50/50 rounded-lg p-4">
            <div className="text-xs uppercase tracking-wider text-red-700 font-semibold mb-1">
              Right-leaning position
            </div>
            <div className="text-sm text-gray-800">{data.rightPosition}</div>
          </div>
        </div>
      </section>

      {/* Channel leaderboard */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">Channels covering this issue</h2>
            <span className="text-xs text-gray-500">last 30 days, sorted by share of voice</span>
          </div>
          {data.channels.length === 0 ? (
            <div className="text-sm text-gray-500 italic">
              No classifications for this issue yet.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
              {data.channels.map((c) => {
                const pct = ((c.lean + 10) / 20) * 100;
                return (
                  <a
                    key={c.channel_id}
                    href={`/channels/${c.channel_id}`}
                    className="block px-4 py-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanBadge(c.channel_lean)}`}
                        >
                          {c.channel_lean}
                        </span>
                        <span className="font-medium truncate">{c.channel_name}</span>
                      </div>
                      <div className={`text-sm font-semibold tabular-nums whitespace-nowrap ${leanColor(c.lean)}`}>
                        {formatLean(c.lean)}
                      </div>
                    </div>
                    <div className="mt-2 relative h-1.5 rounded-full bg-gradient-to-r from-blue-500 via-gray-200 to-red-500">
                      <div
                        className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-gray-900 border-2 border-white"
                        style={{ left: `${pct}%`, transform: "translate(-50%, -50%)" }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-1.5 tabular-nums">
                      {c.numMentions} mentions · share-of-voice weight {c.weight.toLocaleString()}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
