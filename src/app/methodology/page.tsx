import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export const dynamic = "force-dynamic";

export default function MethodologyPage() {
  return (
    <main className="min-h-screen">
      <Header activePage="methodology" />

      <section className="px-6 pt-10 pb-16 max-w-3xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Methodology</h1>
        <p className="text-gray-600 mt-3 leading-relaxed">
          Soapbox measures alt-media political discourse the way you&apos;d want it measured: with
          the math, the channel list, and the limitations all visible. This page is the source of
          truth for how every number on the site is computed. The full pipeline runs nightly via
          scheduled cron, so every figure on the site reflects the most recent 24 hours of ingested
          content.
        </p>

        <h2 className="text-xl font-semibold mt-12">What we measure</h2>
        <p className="text-gray-700 mt-3 leading-relaxed">
          We track a hand-curated set of high-reach alternative-media political channels
          (podcasts and YouTube shows) and analyze what they&apos;re saying about a defined set of
          political issues. We classify each substantive issue mention, then score it on alignment
          with the left or right position and the intensity of expression.
        </p>

        <h2 className="text-xl font-semibold mt-12">The Soapbox Index</h2>
        <p className="text-gray-700 mt-3 leading-relaxed">
          The headline number on the home page. It compresses every issue mention across every
          channel from <strong>the trailing 7-day window ending today</strong> into one signed
          value. The window slides forward each day as the cron runs, so the Index always reflects
          the most recent week of content but updates daily as new episodes are ingested.
        </p>
        <div className="mt-4 p-5 bg-gray-50 border border-gray-200 rounded-md font-mono text-sm text-gray-800 leading-relaxed">
          reach_factor = log10(max(channel_reach, 10))
          <br />
          weight = intensity × reach_factor
          <br />
          contribution = sentiment × weight
          <br />
          <br />
          weighted_lean = Σ contribution / Σ weight
          <br />
          soapbox_index = clip(weighted_lean × 2, -10, +10)
        </div>
        <p className="text-gray-700 mt-4 leading-relaxed">
          A reading of <span className="font-semibold text-red-600">R+1.2</span> means
          alt-media voices, weighted by audience reach and intensity of expression, are net 1.2
          points right of center on the -10/+10 scale this week.
        </p>

        <p className="text-gray-700 mt-4 leading-relaxed">
          The per-issue breakdown that explains today&apos;s Index lives on the{" "}
          <a href="/" className="underline hover:text-gray-900">home page</a>, where it
          stays aligned with the headline number.
        </p>

        <h2 className="text-xl font-semibold mt-12">Channel selection</h2>
        <p className="text-gray-700 mt-3 leading-relaxed">
          Channels are curated by the founding team and balanced across Left, Middle, and Right
          political-publishing posture, <em>not</em> by individual host beliefs. The list reflects
          share-of-voice in alt-media, which has a structural right-of-center skew in published
          reach. Pretending the split is even would be dishonest measurement; the imbalance is the
          finding, not a bug. Every channel&apos;s classification rationale is available on the
          relevant <a href="/channels" className="underline hover:text-gray-900">channels page</a>.
        </p>

        <h2 className="text-xl font-semibold mt-12">Issue taxonomy</h2>
        <p className="text-gray-700 mt-3 leading-relaxed">
          A v0 set of 15 issues: Immigration, Inflation, Israel-Gaza, Ukraine, China policy,
          Trump/GOP, Democratic leadership, Transgender/LGBTQ policy, Crime, Election integrity, AI
          policy, Free speech, Education/DEI, Abortion, Climate. For each issue we declare a
          left-leaning and right-leaning position; the sentiment score on every classification is
          measured against those positions, not against US-political stereotypes.
        </p>

        <h2 className="text-xl font-semibold mt-12">Classification and scoring</h2>
        <p className="text-gray-700 mt-3 leading-relaxed">
          For every episode we ingest, we pull a transcript (PodScan for podcasts; YouTube
          auto-captions for video). We then run two LLM passes:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2 text-gray-700 leading-relaxed">
          <li>
            <strong>Classify</strong> (Claude Sonnet 4.6): read the full transcript, return a list
            of <em>substantive</em> issue mentions with a supporting quote each. Passing
            references, ad reads, and unrelated content are excluded.
          </li>
          <li>
            <strong>Score</strong> (Claude Haiku 4.5): for each classification, rate the
            supporting quote on sentiment (-5..+5 relative to the issue&apos;s defined L/R
            positions) and intensity (1..5).
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-12">Known limitations</h2>
        <ul className="list-disc pl-6 mt-3 space-y-2 text-gray-700 leading-relaxed">
          <li>
            <strong>Transcript coverage</strong>: some channels (notably Bannon&apos;s War Room)
            aren&apos;t transcribed by our podcast provider; we have their metadata but can&apos;t
            score them yet. These appear in channel listings but contribute no Soapbox Score.
          </li>
          <li>
            <strong>Short-form content</strong>: YouTube Shorts (under 3 minutes) are filtered
            from ingestion because they don&apos;t contain enough discussion to score reliably.
            That underweights creators (e.g., Adam Mockler, Matt Walsh) whose YouTube presence is
            primarily clips. Their podcast feeds, where available, fill the gap.
          </li>
          <li>
            <strong>Classifier noise</strong>: individual sentiment scores are accurate around
            85-90% directionally. At aggregate level (per issue, per week, per channel) this washes
            out. Don&apos;t over-interpret a single quote&apos;s score.
          </li>
          <li>
            <strong>Latency</strong>: podcast transcripts arrive ~hours to days after publish,
            depending on the show. The Soapbox Index reflects what&apos;s been transcribed at
            measurement time, not every word spoken in the past week.
          </li>
          <li>
            <strong>Editorial choice</strong>: the L/R position assignments are editorial and
            reviewed quarterly. We choose them deliberately and publish them rather than hiding
            them in code.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-12">Update cadence</h2>
        <p className="text-gray-700 mt-3 leading-relaxed">
          The full pipeline (ingest → transcribe → classify → score) runs as a single scheduled
          job at 6 AM Eastern, daily. New episodes from the past day are ingested, transcribed,
          classified, and scored. The Soapbox Index, issue contributions, channel drill-downs,
          and per-issue trends recompute against the trailing 7-day window from the data
          available at run time. Headline numbers on the site therefore <em>refresh once per day</em>;
          the rolling-window methodology keeps each daily reading stable rather than swinging
          with each new episode.
        </p>

        <h2 className="text-xl font-semibold mt-12">Why this exists</h2>
        <p className="text-gray-700 mt-3 leading-relaxed">
          Political influence has moved from cable and print to podcasts and YouTube. Polling and
          legacy media-monitoring don&apos;t capture this. Soapbox is built so consumers, creators,
          and political operatives all have a way to see past their own algorithmic bubble.
        </p>
      </section>

      <Footer />
    </main>
  );
}
