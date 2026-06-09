"use client";

import { Line, LineChart, ReferenceLine, YAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

/**
 * Tiny inline trend line, standardized on Recharts v3 + the shadcn ChartContainer
 * instead of hand-rolled <svg>/<polyline>. Decorative (no axes, no tooltip): it
 * shows the shape of a short series next to a label. Two house variants:
 *  - lean sparkline: domain [-10, 10] with a neutral zero reference line,
 *    stroke colored by side via `color`.
 *  - volume sparkline: domain [0, auto], neutral gray stroke, no zero line.
 */
interface SparklineProps {
  values: number[];
  /** Stroke color - pass a --chart-* token, e.g. "var(--chart-neutral)". */
  color?: string;
  width?: number;
  height?: number;
  /** Y-axis domain. Defaults to data-fit. Pass [-10, 10] for lean. */
  domain?: [number | "auto", number | "auto"];
  /** Draw a dashed neutral reference line at y=0 (for lean sparklines). */
  zeroLine?: boolean;
}

export function Sparkline({
  values,
  color = "var(--chart-neutral)",
  width = 64,
  height = 20,
  domain = [0, "auto"],
  zeroLine = false,
}: SparklineProps) {
  if (values.length < 2) return null;

  const data = values.map((v, i) => ({ i, v }));
  const config = { v: { color } } satisfies ChartConfig;

  return (
    <ChartContainer
      config={config}
      // Cancel the default aspect-video; sparklines are fixed-size.
      className="aspect-auto shrink-0"
      style={{ width, height }}
    >
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis hide domain={domain} />
        {zeroLine && (
          <ReferenceLine y={0} stroke="var(--chart-muted)" strokeWidth={0.5} />
        )}
        <Line
          dataKey="v"
          type="monotone"
          stroke="var(--color-v)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
