import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export const dynamic = "force-dynamic";

export default function MethodologyPage() {
  return (
    <main className="min-h-screen">
      <Header activePage="methodology" />

      <section className="px-6 pt-10 pb-16 max-w-3xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Methodology</h1>
        <p className="text-ink-muted mt-3 leading-relaxed">
          This page documents exactly how every number on Soapbox is computed - the data sources,
          the math, the channel list, and the known limitations. If a figure appears on the site,
          its derivation is here. The pipeline runs once daily, so every figure reflects the
          content ingested as of the most recent run.
        </p>

        <h2 className="text-xl font-semibold mt-12">What we measure</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          We track a curated set of high-reach political channels on YouTube and podcasts
          and analyze what they&apos;re saying about a defined set of political issues. We classify
          each substantive issue mention, then score it on alignment with the left or right
          position and the intensity of expression.
        </p>

        <h2 className="text-xl font-semibold mt-12">The Soapbox Index</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          The headline number on the home page. It compresses every issue mention across every
          channel from <strong>the trailing 7-day window ending today</strong> into one signed
          value. The window slides forward each day as the cron runs, so the Index always reflects
          the most recent week of content but updates daily as new episodes are ingested.
        </p>
        <div className="mt-4 p-5 bg-subtle border border-border rounded-md font-mono text-sm text-ink-strong leading-relaxed">
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
        <p className="text-ink-body mt-4 leading-relaxed">
          A reading of <span className="font-semibold text-red-600">R+1.2</span> means the
          channels we track, weighted by audience reach and intensity of expression, are net 1.2
          points right of center on the -10/+10 scale this week.
        </p>
        <p className="text-ink-body mt-4 leading-relaxed">
          Two deliberate choices keep this honest. First, every voice is weighted by its{" "}
          <strong>audience reach</strong> (the <code className="text-sm">log10</code> above), so a
          5M-subscriber show counts for more than a 50K one - the Index reflects what audiences
          actually hear, not a one-channel-one-vote average. Second, each channel is{" "}
          <strong>capped at 3 episodes per day</strong>, so a high-frequency publisher can&apos;t
          flood the Index by sheer posting volume. The result measures <em>stance per unit of
          audience</em> - where a channel leans and how big its audience is - not who posts most
          often.
        </p>

        <p className="text-ink-body mt-4 leading-relaxed">
          The per-issue breakdown that explains today&apos;s Index lives on the{" "}
          <a href="/" className="underline hover:text-foreground">home page</a>, where it
          stays aligned with the headline number.
        </p>

        <h2 className="text-xl font-semibold mt-12">Channel selection</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Channels are curated by the founding team and balanced across Left, Middle, and Right
          political-publishing posture, <em>not</em> by individual host beliefs. The list reflects
          share-of-voice on the platform, which skews structurally right-of-center in published
          reach. Pretending the split is even would be dishonest measurement; the imbalance is the
          finding, not a bug. Every channel&apos;s classification rationale is available on the
          relevant <a href="/channels" className="underline hover:text-foreground">channels page</a>.
        </p>

        <h2 className="text-xl font-semibold mt-12">Audience reach: how we measure it</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Reach is the weighting input in the Index formula above, so it deserves its own
          disclosure. The two platforms are measured differently, because the data available for
          them is fundamentally different.
        </p>
        <p className="text-ink-body mt-4 leading-relaxed">
          <strong>YouTube channels</strong> use subscriber counts from the YouTube Data API,
          refreshed automatically every day during the ingest pass. These are measured values
          straight from the platform - current, consistent, and not subject to our judgment.
        </p>
        <p className="text-ink-body mt-4 leading-relaxed">
          <strong>Podcasts</strong> have no equivalent. No public per-show audience measurement
          exists at panel scale: the professional sources (Edison, Triton) are enterprise-gated
          and cover only top-chart shows, and when we tested commercial aggregators&apos; audience
          fields against shows with publicly corroborated numbers, the values were unusable -
          one put a 7M-listener show at 100 listeners. So podcast reach is{" "}
          <strong>editorial</strong>: an estimated weekly US audience, set by hand and bracketed
          to coarse tiers (150k, 300k, 500k, 1M, …) rather than presented with false precision.
        </p>
        <p className="text-ink-body mt-4 leading-relaxed">
          Estimates are anchored to the ~28 shows whose audiences are publicly corroborated
          (Edison rankings, publisher announcements), and the remaining panel is placed on that
          scale using multiple signals: chart positions, ratings volume, public rankers,
          YouTube presence for video-native shows, and a commercial popularity score we
          calibrated against the anchors and use only as a weak prior. Values are reviewed at
          panel-add time and recalibrated periodically; the most recent full-panel pass was
          June&nbsp;2026.
        </p>
        <p className="text-ink-body mt-4 leading-relaxed">
          Why this is tolerable: the Index weights by <code className="text-sm">log10(reach)</code>,
          which compresses estimation error. If we&apos;re wrong about a show&apos;s audience by 2×,
          its weight moves by about 0.3 (log10 of 2), or roughly 5% of a typical weight - not 2×.
          The ordering across tiers matters far more than precision within a tier, and the
          ordering is what the anchoring protects.
        </p>

        <h2 className="text-xl font-semibold mt-12">Cohorts: independent vs legacy</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          We track two cohorts of channel on the same platform (YouTube and podcasts), scored the
          same way:
        </p>
        <ul className="text-ink-body mt-3 leading-relaxed list-disc pl-5 space-y-2">
          <li>
            <strong>Independent</strong> - creator and digital-native outlets (e.g. Breaking Points,
            The Young Turks, the Shapiro/Walsh shows). The audience is there for the politics.
          </li>
          <li>
            <strong>Legacy</strong> - traditional media institutions&apos; presence on the platform
            (e.g. Fox News, MSNBC, NPR, PBS). We curate legacy to politics-heavy channels so reach
            stands in for political audience, not general-news viewership.
          </li>
        </ul>
        <p className="text-ink-body mt-3 leading-relaxed">
          The headline Index blends both cohorts, weighted by audience as above; the two
          sub-needles on the <a href="/" className="underline hover:text-foreground">home page</a> show
          each cohort on its own, so the split that the blended number averages over stays visible.
          Legacy follows the same 3-episodes/day cap as everyone else, so a high-volume newsroom
          can&apos;t dominate by posting frequency.
        </p>

        <h2 className="text-xl font-semibold mt-12">Issue taxonomy</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          A set of 16 issues: Immigration, Inflation, Israel–Gaza, Ukraine, China policy,
          Trump/GOP, Democratic leadership, Transgender/LGBTQ policy, Crime, Election integrity, AI
          policy, Free speech, Education/DEI, Abortion, Climate, and the Iran conflict. For each
          issue we declare a left-leaning and right-leaning position; the sentiment score on every
          classification is measured against those positions, not against US-political stereotypes.
          The taxonomy expands as new themes become dominant in the discourse.
        </p>

        <h2 className="text-xl font-semibold mt-12">Classification and scoring</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          For every episode we ingest, we pull a transcript (PodScan for podcasts; YouTube
          auto-captions for video). We then run two LLM passes:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2 text-ink-body leading-relaxed">
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
        <ul className="list-disc pl-6 mt-3 space-y-2 text-ink-body leading-relaxed">
          <li>
            <strong>Transcript coverage</strong>: a small fraction of episodes can&apos;t be
            transcribed - a podcast feed without a published transcript, or a video without
            captions. Those episodes are still ingested and listed but contribute no Soapbox Score
            until a transcript becomes available.
          </li>
          <li>
            <strong>Short-form content</strong>: very short clips (under ~2 minutes) are filtered
            from ingestion because they rarely contain enough discussion to score reliably. The
            floor was lowered in 2026 to admit substantive short-form shows (e.g., NowThis Impact);
            creators whose presence is primarily sub-2-minute clips remain underweighted, and their
            podcast feeds, where available, fill the gap.
          </li>
          <li>
            <strong>Scoring is model-produced and being calibrated</strong>: sentiment and
            intensity are assigned by a language model, so individual scores carry noise and the
            model can lean on the extremes of the scale. We&apos;re actively validating and
            calibrating it against independent human labels. Read the aggregates (per issue, per
            week, per channel), not any single quote&apos;s score.
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
        <p className="text-ink-body mt-3 leading-relaxed">
          The full pipeline (ingest → transcribe → classify → score) runs as a single scheduled
          job at 6 AM Eastern, daily. New episodes from the past day are ingested, transcribed,
          classified, and scored. The Soapbox Index, issue contributions, channel drill-downs,
          and per-issue trends recompute against the trailing 7-day window from the data
          available at run time. Headline numbers on the site therefore <em>refresh once per day</em>;
          the rolling-window methodology keeps each daily reading stable rather than swinging
          with each new episode.
        </p>

        <h2 className="text-xl font-semibold mt-12">Why this exists</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Political influence has moved from cable and print to podcasts and YouTube. Polling and
          legacy media-monitoring don&apos;t capture this. Soapbox is built so consumers, creators,
          and political operatives all have a way to see past their own algorithmic bubble.
        </p>
      </section>

      <Footer />
    </main>
  );
}
