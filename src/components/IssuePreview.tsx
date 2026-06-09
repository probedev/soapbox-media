import { Sparkline } from "@/components/ui/sparkline";

interface IssuePreviewProps {
  slug: string;
  name: string;
  /** -10 .. +10 */
  lean: number;
  /** total Soapbox Score volume this week */
  volume: number;
  /** 8-week trajectory of this issue's lean, oldest first */
  trend?: number[];
}

export function IssuePreview({ slug, name, lean, volume, trend }: IssuePreviewProps) {
  const clamped = Math.max(-10, Math.min(10, lean));
  const leanLabel =
    clamped > 0
      ? `R+${clamped.toFixed(1)}`
      : clamped < 0
      ? `L+${Math.abs(clamped).toFixed(1)}`
      : "Even";
  const leanColor =
    clamped > 0 ? "text-red-600" : clamped < 0 ? "text-blue-600" : "text-gray-600";
  const markerPct = ((clamped + 10) / 20) * 100;

  return (
    <a
      href={`/issues/${slug}`}
      className="block border border-gray-200 rounded-lg p-4 bg-white hover:border-gray-400 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-gray-900">{name}</div>
        <div className={`text-sm font-semibold whitespace-nowrap tabular-nums ${leanColor}`}>
          {leanLabel}
        </div>
      </div>
      <div className="mt-4 relative h-2 rounded-full bg-gradient-to-r from-blue-500 via-gray-200 to-red-500">
        <div
          className="absolute top-1/2 w-3 h-3 rounded-full bg-gray-900 border-2 border-white shadow"
          style={{ left: `${markerPct}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span className="tabular-nums">Volume {volume.toLocaleString()}</span>
        {trend && trend.length >= 2 && (
          <Sparkline
            values={trend}
            width={72}
            height={18}
            domain={[-10, 10]}
            zeroLine
            color={sparkColor(trend[trend.length - 1])}
          />
        )}
      </div>
    </a>
  );
}

/** Lean sparkline stroke: red right, blue left, neutral at center. */
function sparkColor(lastVal: number): string {
  if (lastVal > 0) return "var(--chart-right)";
  if (lastVal < 0) return "var(--chart-left)";
  return "var(--chart-neutral)";
}
