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

function formatLastUpdated(iso: string | null): string {
  if (!iso) return "Awaiting first run";
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffH / 24);
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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
  return (
    <div className="border border-gray-200 rounded-lg bg-white p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
          System scale
        </h2>
        <span className="text-[11px] text-gray-500 tabular-nums">
          Last classification: {formatLastUpdated(stats.lastUpdated)}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
        <Stat value={stats.channelsTracked.toString()} label="Channels tracked" sublabel="Across L / M / R" />
        <Stat value={compactNumber(stats.episodesAnalyzed)} label="Episodes ingested" />
        <Stat value={hoursLabel(stats.hoursOfAudio)} label="Hours of audio" sublabel="Long-form, Shorts filtered" />
        <Stat value={compactNumber(stats.wordsTranscribedEstimate)} label="Words transcribed" sublabel="Estimated at 150 wpm" />
        <Stat value={compactNumber(stats.classifications)} label="Issue mentions" sublabel="Substantive only" />
        <Stat value={compactNumber(stats.sentimentScores)} label="Sentiment scores" sublabel="LLM-classified" />
      </div>
    </div>
  );
}
