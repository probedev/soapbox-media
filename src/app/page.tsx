import { SoapboxNeedle } from "@/components/SoapboxNeedle";
import { IssuePreview } from "@/components/IssuePreview";
import { IndexSparkline } from "@/components/IndexSparkline";
import { WeeklyHeadline } from "@/components/WeeklyHeadline";
import { BiggestMovers } from "@/components/BiggestMovers";
import { TrustStrip } from "@/components/TrustStrip";

// Placeholder data — every number here is a stand-in. The live pipeline
// (Day 4-5) will populate these from the Supabase tables seeded with real
// classifications + sentiment scores. We deliberately do NOT attribute fake
// quotes to real channels in placeholder mode.
const PLACEHOLDER_INDEX = 1.2;
const PLACEHOLDER_DELTA = 0.4;
const PLACEHOLDER_WEEK = "Week of May 5, 2026";
const PLACEHOLDER_LAST_UPDATED = "2026-05-09T10:00:00Z";

const INDEX_HISTORY_12W = [
  -0.2, 0.1, -0.5, -0.8, 0.3, 0.7, 1.1, 0.6, 0.9, 0.4, 0.8, 1.2,
];

const PLACEHOLDER_ISSUES = [
  { slug: "immigration", name: "Immigration & border", lean: 3.4, volume: 1240, trend: [2.1, 2.6, 2.4, 2.9, 3.0, 3.1, 3.2, 3.4] },
  { slug: "israel-gaza", name: "Israel–Gaza", lean: -1.1, volume: 980, trend: [0.4, 0.1, -0.3, -0.7, -1.0, -1.2, -1.0, -1.1] },
  { slug: "trump-gop", name: "Trump / GOP leadership", lean: 2.7, volume: 940, trend: [2.2, 2.4, 2.5, 2.6, 2.8, 2.6, 2.5, 2.7] },
  { slug: "inflation", name: "Inflation & affordability", lean: 0.3, volume: 720, trend: [0.7, 0.6, 0.5, 0.4, 0.5, 0.4, 0.2, 0.3] },
  { slug: "transgender", name: "Transgender / LGBTQ policy", lean: 4.2, volume: 510, trend: [3.6, 3.8, 4.0, 3.9, 4.1, 4.2, 4.0, 4.2] },
  { slug: "election-integrity", name: "Election integrity", lean: 2.1, volume: 480, trend: [1.7, 1.8, 1.9, 2.0, 2.2, 2.1, 2.0, 2.1] },
];

const PLACEHOLDER_MOVERS = [
  { slug: "immigration", name: "Immigration & border", delta: 0.8, fromLean: 2.6, toLean: 3.4 },
  { slug: "transgender", name: "Transgender / LGBTQ policy", delta: 0.6, fromLean: 3.6, toLean: 4.2 },
  { slug: "israel-gaza", name: "Israel–Gaza", delta: -0.4, fromLean: -0.7, toLean: -1.1 },
  { slug: "ukraine-russia", name: "Ukraine–Russia", delta: 0.3, fromLean: -1.4, toLean: -1.1 },
  { slug: "inflation", name: "Inflation & affordability", delta: -0.3, fromLean: 0.6, toLean: 0.3 },
];

export default function HomePage() {
  const directionLabel = PLACEHOLDER_INDEX >= 0 ? "R+" : "L+";
  const directionWord = PLACEHOLDER_INDEX >= 0 ? "right" : "left";
  const indexColor = PLACEHOLDER_INDEX >= 0 ? "text-red-600" : "text-blue-600";
  const deltaPositive = PLACEHOLDER_DELTA >= 0;

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-baseline gap-1">
            <span className="font-bold text-xl tracking-tight">soapbox</span>
            <span className="text-xs text-gray-500 hidden sm:inline">.media</span>
          </a>
          <nav className="text-sm text-gray-600 flex gap-6">
            <a href="/issues" className="hover:text-gray-900">Issues</a>
            <a href="/channels" className="hover:text-gray-900">Channels</a>
            <a href="/methodology" className="hover:text-gray-900">Methodology</a>
          </nav>
        </div>
      </header>

      {/* Hero — needle + headline number + sparkline + trust strip */}
      <section className="px-6 pt-12 pb-10 max-w-5xl mx-auto text-center">
        <div className="uppercase text-xs font-semibold tracking-wider text-gray-500 mb-2">
          The Soapbox Index
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Where is alt-media leaning this week?
        </h1>
        <p className="text-gray-600 mt-3 max-w-2xl mx-auto">
          We listen to the top political podcasts and YouTube voices, classify what
          they&apos;re saying, and surface a single read on where the discourse is moving —
          so you can see past your own algorithmic bubble.
        </p>

        <div className="mt-10 flex justify-center">
          <SoapboxNeedle value={PLACEHOLDER_INDEX} />
        </div>

        <div className="mt-2">
          <div className={`text-7xl font-semibold tracking-tight tabular-nums ${indexColor}`}>
            {directionLabel}
            {Math.abs(PLACEHOLDER_INDEX).toFixed(1)}
          </div>
          <div className="text-sm text-gray-600 mt-3">
            Alt-media tilted <span className="font-medium">{directionWord}</span> this week.{" "}
            <span className={`font-semibold tabular-nums ${deltaPositive ? "text-red-600" : "text-blue-600"}`}>
              {deltaPositive ? "↑" : "↓"} {Math.abs(PLACEHOLDER_DELTA).toFixed(1)}
            </span>{" "}
            from last week
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-1">
          <IndexSparkline values={INDEX_HISTORY_12W} />
          <div className="text-[10px] uppercase tracking-wider text-gray-400">
            12-week history
          </div>
        </div>

        <div className="mt-8">
          <TrustStrip
            numChannels={42}
            numEpisodes={247}
            lastUpdated={PLACEHOLDER_LAST_UPDATED}
            weekLabel={PLACEHOLDER_WEEK}
            isPlaceholder
          />
        </div>
      </section>

      {/* Weekly headline */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="uppercase text-xs font-semibold tracking-wider text-gray-500 mb-3 text-center">
            This week
          </div>
          <WeeklyHeadline />
        </div>
      </section>

      {/* Biggest movers */}
      <section className="border-t border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <BiggestMovers movers={PLACEHOLDER_MOVERS} />
        </div>
      </section>

      {/* Top issues */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-lg font-semibold">Top issues this week</h2>
            <a href="/issues" className="text-sm text-gray-600 hover:text-gray-900">
              All issues →
            </a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PLACEHOLDER_ISSUES.map((issue) => (
              <IssuePreview key={issue.slug} {...issue} />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-gray-500 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>Soapbox.media · alt-media discourse, measured weekly</div>
          <div className="flex gap-4">
            <a href="/methodology" className="underline hover:text-gray-900">
              How we measure
            </a>
            <a href="/channels" className="underline hover:text-gray-900">
              Channels we track
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
