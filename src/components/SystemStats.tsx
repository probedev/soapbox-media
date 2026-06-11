import { getSystemStats } from "@/lib/aggregate";
import { Card } from "@/components/ui/card";

function compactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function hoursLabel(h: number): string {
  // Show the full number for hours - "1,433" reads as concrete data, where
  // the previous compact "1.4K" was easy to mistake for an unwired placeholder.
  // (v0.6.54.) Sub-hour values are unlikely on a daily-ingested pipeline.
  if (h >= 100) return Math.round(h).toLocaleString();
  return h.toFixed(1);
}

function daysContinuous(h: number): string {
  const days = h / 24;
  if (days >= 10) return `≈ ${Math.round(days)} days continuous`;
  if (days >= 1) return `≈ ${days.toFixed(1)} days continuous`;
  return `≈ ${Math.round(h)} hours continuous`;
}

interface StatProps {
  value: string;
  label: string;
  sublabel?: string;
}

function Stat({ value, label, sublabel }: StatProps) {
  return (
    <div>
      <div className="text-3xl md:text-4xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mt-2 font-medium">
        {label}
      </div>
      {sublabel && <div className="text-[11px] text-ink-faint mt-0.5">{sublabel}</div>}
    </div>
  );
}

export async function SystemStats() {
  const stats = await getSystemStats();
  const leanSplit = `${stats.channelsByLean.L} L · ${stats.channelsByLean.M} M · ${stats.channelsByLean.R} R`;

  // /log SystemStats is *pipeline-scale* only - what the system has been
  // doing. Panel-composition numbers (combined audience reach, platform
  // split, largest show) moved to <PanelScale> on /channels in v0.6.56,
  // where they answer the reader question "is this panel representative?"
  // rather than "is the pipeline running?". Shows-tracked stays here as
  // the denominator that contextualizes the processing numbers.
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-5">
        System scale
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Stat
          value={stats.channelsTracked.toString()}
          label="Shows tracked"
          sublabel={leanSplit}
        />
        <Stat
          value={compactNumber(stats.episodesAnalyzed)}
          label="Episodes analyzed"
          sublabel={`of ${compactNumber(stats.episodesIngested)} ingested`}
        />
        <Stat
          value={hoursLabel(stats.hoursOfAudio)}
          label="Hours of audio"
          sublabel={daysContinuous(stats.hoursOfAudio)}
        />
        <Stat
          value={compactNumber(stats.classifications)}
          label="Issue mentions"
          sublabel={`Across ${stats.activeIssues} issues, all sentiment-scored`}
        />
      </div>
    </Card>
  );
}
