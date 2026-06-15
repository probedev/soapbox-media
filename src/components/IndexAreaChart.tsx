"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DISPLAY_TZ } from "@/lib/utils";
import { formatLean } from "@/lib/lean";

interface IndexAreaChartProps {
  /** Soapbox Index values, oldest first. Range −10..+10. */
  values: number[];
  /** ISO date (YYYY-MM-DD) per value, same order/length. */
  dates: string[];
  /** Rolling-window length in days (for the caption). */
  windowDays?: number;
  /**
   * Tailwind max-width class for the chart container. Defaults to `max-w-md`
   * (the narrow home-page hero). Pass `""` to let it fill its parent - used in
   * the wide issue/channel drill-down cards.
   */
  maxWidthClass?: string;
  /**
   * Whether the vertical range must include 0 (the neutral line). True for the
   * home Index (so the L/R side is obvious). False for an issue/channel that
   * sits far from center - fit to the data so the line uses the full height
   * instead of leaving dead space.
   */
  includeZero?: boolean;
}

function formatShortDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: DISPLAY_TZ,
  });
}

function sideColor(v: number): string {
  return v > 0.05 ? "#ef4444" : v < -0.05 ? "#3b82f6" : "#6b7280";
}

const chartConfig = {
  index: { label: "Soapbox Index", color: "var(--chart-index)" },
} satisfies ChartConfig;

interface Point {
  date: string;
  index: number;
}

export function IndexAreaChart({
  values,
  dates,
  windowDays = 7,
  maxWidthClass = "max-w-md",
  includeZero = true,
}: IndexAreaChartProps) {
  if (values.length < 2) return null;

  const data: Point[] = values.map((v, i) => ({ date: dates[i] ?? "", index: v }));

  // Domain always includes 0 (so the neutral line is visible and the side is
  // obvious), padded a little so movement is legible without exaggeration.
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Home Index anchors to 0 so the L/R side is obvious; entity charts fit to
  // their own data so the line uses the full height (no dead space when the
  // entity sits far from neutral).
  const rawLo = includeZero ? Math.min(0, dataMin) : dataMin;
  const rawHi = includeZero ? Math.max(0, dataMax) : dataMax;
  const pad = Math.max(0.5, (rawHi - rawLo) * 0.15);
  const lo = Math.max(-10, rawLo - pad);
  const hi = Math.min(10, rawHi + pad);

  const minVal = formatLean(dataMin, "Even");
  const maxVal = formatLean(dataMax, "Even");

  return (
    <div className={`w-full ${maxWidthClass}`}>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="fillIndex" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-index)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-index)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={40}
            tickFormatter={formatShortDate}
          />
          <YAxis
            domain={[lo, hi]}
            width={40}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            tickFormatter={(v: number) => formatLean(v, "Even")}
          />
          {includeZero && (
            <ReferenceLine y={0} stroke="var(--chart-muted)" strokeDasharray="2 2" />
          )}
          <ChartTooltip
            cursor={{ stroke: "var(--chart-muted)" }}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(value) => formatShortDate(String(value))}
                formatter={(value) => (
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: sideColor(Number(value)) }}
                  >
                    {formatLean(Number(value), "Even")}
                  </span>
                )}
              />
            }
          />
          <Area
            dataKey="index"
            type="monotone"
            stroke="var(--color-index)"
            strokeWidth={2}
            fill="url(#fillIndex)"
            // Fill from the line down to the bottom of the range. When the range
            // is anchored to 0 (home), let Recharts default to the 0 baseline;
            // otherwise fill to the bottom of the fitted range.
            baseValue={includeZero ? undefined : lo}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ChartContainer>

      <div className="text-[10px] uppercase tracking-wider text-ink-faint mt-1 text-center">
        Range{" "}
        <span className="tabular-nums text-ink-muted font-medium normal-case">{minVal}</span> to{" "}
        <span className="tabular-nums text-ink-muted font-medium normal-case">{maxVal}</span> ·
        rolling {windowDays}-day index
      </div>
    </div>
  );
}
