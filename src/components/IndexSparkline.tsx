interface IndexSparklineProps {
  /** Soapbox Index values across N weeks, oldest first. Range -10..+10. */
  values: number[];
  width?: number;
  height?: number;
}

/**
 * Compact line chart of the Soapbox Index over recent weeks.
 * Pure SVG — no client state, no JS chart lib.
 */
export function IndexSparkline({ values, width = 320, height = 64 }: IndexSparklineProps) {
  if (values.length < 2) return null;

  const minY = -10;
  const maxY = 10;
  const padX = 4;
  const padY = 6;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const points = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * plotW;
    const yNorm = (v - minY) / (maxY - minY);
    const y = padY + (1 - yNorm) * plotH;
    return [x, y] as const;
  });

  const pathD = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  const zeroY = padY + (1 - (0 - minY) / (maxY - minY)) * plotH;
  const lastValue = values[values.length - 1];
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Soapbox Index history, latest value ${lastValue.toFixed(1)}`}
    >
      <line
        x1={padX}
        y1={zeroY}
        x2={width - padX}
        y2={zeroY}
        stroke="#e5e7eb"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <path
        d={pathD}
        stroke="#374151"
        strokeWidth="1.75"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="3.5"
        fill={lastValue > 0 ? "#ef4444" : lastValue < 0 ? "#3b82f6" : "#374151"}
      />
    </svg>
  );
}
