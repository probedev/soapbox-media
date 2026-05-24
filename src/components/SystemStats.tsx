import { getSystemStats } from "@/lib/aggregate";

function compactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function hoursLabel(h: number): string {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}K`;
  if (h >= 100) return Math.round(h).toLocaleString();
  return h.toFixed(1);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffH / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  return `${diffDay}d ago`;
}

function monthYear(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

interface StatProps {
  value: string;
  label: string;
  sublabel?: string;
}

function Stat({ value, label, sublabel }: StatProps) {
  return (
    <div>
      <div className="text-3xl md:text-4xl font-semibold tracking-tight tabular-nums text-gray-900">
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-gray-500 mt-2 font-medium">
        {label}
      </div>
      {sublabel && <div className="text-[11px] text-gray-400 mt-0.5">{sublabel}</div>}
    </div>
  );
}

export async function SystemStats() {
  const stats = await getSystemStats();
  const leanSplit = `${stats.channelsByLean.L} L · ${stats.channelsByLean.M} M · ${stats.channelsByLean.R} R`;

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-6">
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
          System scale
        </h2>
        <span className="text-[11px] text-gray-500 tabular-nums">
          Latest data {relativeTime(stats.lastUpdated)}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
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
          sublabel="Long-form, Shorts filtered"
        />
        <Stat
          value={compactNumber(stats.classifications)}
          label="Issue mentions"
          sublabel="Across 15 issues"
        />
        <Stat
          value={compactNumber(stats.sentimentScores)}
          label="Sentiment scores"
          sublabel="Every mention scored L↔R"
        />
        <Stat
          value={monthYear(stats.coverageSinceISO)}
          label="Coverage since"
          sublabel="Continuous tracking"
        />
      </div>
    </div>
  );
}
