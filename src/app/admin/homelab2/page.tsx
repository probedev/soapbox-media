/**
 * /admin/homelab2 - staging redesign of the home page as a scrolling, panel-based
 * "enterprise political-analytics dashboard with a realtime feed". Progressive
 * disclosure: the needle anchor + public hooks up top, pro/B2B depth below.
 * Behind admin Basic Auth (middleware, like all /admin/*). Force-dynamic, queries
 * LIVE (heavier than the public home, which reads the precomputed snapshot) - this
 * is a decision/experiment surface; promotion to the real home is a separate step
 * that bakes a panel's aggregates into writeHomeSnapshot.
 */
import { AdminNav } from "@/components/AdminNav";
import { BiggestMovers } from "@/components/BiggestMovers";
import { getHomelab2Data } from "@/lib/homelab2";
import { Reveal } from "@/components/homelab2/reveal";
import { Hero } from "@/components/homelab2/Hero";
import { WhyIndex, TopIssues } from "@/components/homelab2/issue-panels";
import { TwoAmericas, Breaking } from "@/components/homelab2/signature-panels";
import { Ownership, HeatGrid, Momentum, CrossTalk } from "@/components/homelab2/depth-panels";
import { ScaleStrip, ChannelLandscape } from "@/components/homelab2/scale-panels";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function Panel({
  title,
  subtitle,
  audience,
  children,
  minHeight = 220,
}: {
  title: string;
  subtitle?: string;
  audience?: string;
  children: React.ReactNode;
  minHeight?: number;
}) {
  return (
    <Reveal minHeight={minHeight} className="rounded-xl border border-border bg-background p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-strong">{title}</h3>
          {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {audience && <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-faintest">{audience}</span>}
      </div>
      {children}
    </Reveal>
  );
}

function Zone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-[11px] font-mono uppercase tracking-widest text-ink-faint mb-4">{label}</h2>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export default async function Homelab2Page() {
  const d = await getHomelab2Data();

  return (
    <main className="min-h-screen bg-subtle">
      <AdminNav />
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Home page lab v2</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Staging redesign: a scrolling, data-rich dashboard. The needle anchor and public hooks lead;
          analyst and B2B depth follow. Live data ({d.stats.mentions.toLocaleString()} scored mentions) - heavier
          than the public home on purpose. Promotion to the real home is a separate, snapshot-backed step.
        </p>

        {/* Anchor */}
        <section className="mt-10 rounded-xl border border-border bg-background p-6 shadow-sm">
          <Hero
            index={d.index}
            indexDelta={d.indexDelta}
            masterSparkline={d.masterSparkline}
            masterDates={d.masterDates}
            cohorts={d.cohorts}
          />
        </section>

        <Zone label="Why · what's moving">
          <div className="grid lg:grid-cols-2 gap-6">
            <Panel title="Why the index is here" subtitle="Issue contributions pulling the index L/R, with mention volume" audience="Everyone" minHeight={420}>
              <WhyIndex breakdown={d.breakdown} />
            </Panel>
            <Panel title="Top issues" subtitle="Ranked by volume; color is lean" audience="Everyone" minHeight={420}>
              <TopIssues issues={d.topIssues} />
            </Panel>
          </div>
          <Panel title="Biggest movers" subtitle="Week-over-week lean and volume swings" audience="Public + analysts" minHeight={200}>
            <BiggestMovers movers={d.movers} />
          </Panel>
        </Zone>

        <Zone label="The two Americas · what's breaking">
          <Panel title="Two Americas" subtitle="Where independent and legacy media diverge" audience="Analysts / journalists" minHeight={320}>
            <TwoAmericas twoConv={d.twoConv} gap={d.gap} />
          </Panel>
          <Panel title="What's breaking" subtitle="Top emerging events, with favorability and cohort coverage" audience="Public + B2B" minHeight={320}>
            <Breaking breaking={d.breaking} />
          </Panel>
        </Zone>

        <Zone label="Depth">
          <div className="grid lg:grid-cols-2 gap-6">
            <Panel title="Issue ownership" subtitle="Lean x volume - loud-left, loud-right, or up for grabs" audience="Campaigns / B2B" minHeight={360}>
              <Ownership points={d.ownership} />
            </Panel>
            <Panel title="Issue heat grid" subtitle="Eight weeks of salience - hue is lean, opacity is volume" audience="Analysts" minHeight={360}>
              <HeatGrid issues={d.heat.issues} weekLabels={d.heat.weekLabels} />
            </Panel>
            <Panel title="Channel momentum" subtitle="Share-of-voice change vs last week" audience="Media buyers" minHeight={360}>
              <Momentum risers={d.risers} />
            </Panel>
            <Panel title="Cross-talk" subtitle="Who's named across shows this week" audience="Comms / PR" minHeight={300}>
              <CrossTalk rows={d.crossTalk} />
            </Panel>
          </div>
        </Zone>

        <Zone label="Scale · landscape">
          <Panel title="The feed" subtitle="Proof of a continuously-refreshed dataset" audience="Trust / B2B" minHeight={160}>
            <ScaleStrip pulse={d.pulse} stats={d.stats} />
          </Panel>
          <Panel title="Channel landscape" subtitle="The loudest voices, by reach-weighted volume" audience="Media buyers" minHeight={360}>
            <ChannelLandscape nodes={d.megaphone} />
          </Panel>
        </Zone>
      </div>
    </main>
  );
}
