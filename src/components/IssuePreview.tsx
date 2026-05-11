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
        {trend && trend.length >= 2 && <IssueSparkline values={trend} />}
      </div>
    </a>
  );
}

function IssueSparkline({ values }: { values: number[] }) {
  const width = 72;
  const height = 18;
  const minY = -10;
  const maxY = 10;
  const pad = 1.5;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * plotW;
    const yNorm = (v - minY) / (maxY - minY);
    const y = pad + (1 - yNorm) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastVal = values[values.length - 1];
  const color = lastVal > 0 ? "#ef4444" : lastVal < 0 ? "#3b82f6" : "#6b7280";
  const zeroY = pad + (1 - (0 - minY) / (maxY - minY)) * plotH;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#e5e7eb" strokeWidth="0.5" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
