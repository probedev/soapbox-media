interface IndexSparklineProps {
  /** Soapbox Index values, oldest first. Range -10..+10. */
  values: number[];
  /** ISO date (YYYY-MM-DD) for each value, same order. If provided,
   *  endpoint dates are labeled under the chart. */
  dates?: string[];
  /** Window-length label used in the range summary, e.g. "7-day". */
  windowLabel?: string;
  width?: number;
  height?: number;
}

function formatLean(v: number): string {
  if (v > 0.05) return `R+${v.toFixed(1)}`;
  if (v < -0.05) return `L+${Math.abs(v).toFixed(1)}`;
  return "0.0";
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Trend chart of the Soapbox Index over recent days. Pure SVG plus a
 * couple of label rows underneath — no client state, no chart lib.
 *
 * Adds, vs v0.6.x predecessors:
 * - Faint reference lines at ±5 in addition to the zero line, so the
 *   eye can read magnitude at a glance.
 * - Endpoint date labels under the chart so the time range is visible
 *   without context elsewhere.
 * - Range summary text beneath ("Range L+0.3 to L+1.4 · rolling 7-day").
 */
export function IndexSparkline({
  values,
  dates,
  windowLabel = "7-day",
  width = 360,
  height = 80,
}: IndexSparklineProps) {
  if (values.length < 2) return null;

  const minY = -10;
  const maxY = 10;
  const padX = 6;
  const padY = 8;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const yFor = (v: number) =>
    padY + (1 - (v - minY) / (maxY - minY)) * plotH;

  const points = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * plotW;
    return [x, yFor(v)] as const;
  });

  const pathD = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  const lastValue = values[values.length - 1];
  const [lastX, lastY] = points[points.length - 1];

  // Range across the series (used in the summary text)
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  const zeroY = yFor(0);
  const posFiveY = yFor(5);
  const negFiveY = yFor(-5);

  const startDate = dates && dates.length > 0 ? dates[0] : null;
  const endDate = dates && dates.length > 0 ? dates[dates.length - 1] : null;

  return (
    <div style={{ width }} className="flex flex-col">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`Soapbox Index history, latest value ${lastValue.toFixed(1)}`}
      >
        {/* Reference grid: faint lines at ±5, slightly darker dashed at 0 */}
        <line
          x1={padX}
          y1={posFiveY}
          x2={width - padX}
          y2={posFiveY}
          stroke="#f3f4f6"
          strokeWidth="1"
        />
        <line
          x1={padX}
          y1={negFiveY}
          x2={width - padX}
          y2={negFiveY}
          stroke="#f3f4f6"
          strokeWidth="1"
        />
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="#e5e7eb"
          strokeWidth="1"
          strokeDasharray="2 2"
        />

        {/* Trend line */}
        <path
          d={pathD}
          stroke="#374151"
          strokeWidth="1.75"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Most-recent value marker */}
        <circle
          cx={lastX}
          cy={lastY}
          r="3.5"
          fill={lastValue > 0 ? "#ef4444" : lastValue < 0 ? "#3b82f6" : "#374151"}
        />
      </svg>

      {/* Endpoint date labels */}
      {startDate && endDate && (
        <div className="flex justify-between text-[10px] text-gray-500 tabular-nums mt-0.5 px-1">
          <span>{formatShortDate(startDate)}</span>
          <span>{formatShortDate(endDate)}</span>
        </div>
      )}

      {/* Range summary */}
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-2 text-center">
        Range{" "}
        <span className="tabular-nums text-gray-600 font-medium normal-case">
          {formatLean(minVal)}
        </span>{" "}
        to{" "}
        <span className="tabular-nums text-gray-600 font-medium normal-case">
          {formatLean(maxVal)}
        </span>{" "}
        · rolling {windowLabel} index
      </div>
    </div>
  );
}
