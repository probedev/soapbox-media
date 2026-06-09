"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/**
 * Mention-volume sparkline - counterpart to <IndexAreaChart>. Lean values are
 * bimodal (L↔R, anchored at 0); volume values are non-negative counts, so the
 * y-axis starts at 0 and there's no neutral-line reference. Color is neutral
 * gray - attention rising or falling isn't ideologically loaded.
 */
interface VolumeAreaChartProps {
  /** Rolling mention counts, oldest first. */
  values: number[];
  /** ISO date (YYYY-MM-DD) per value, same order/length. */
  dates: string[];
  /** Rolling-window length in days (for the caption). */
  windowDays?: number;
  /**
   * Tailwind max-width class. Defaults to `""` (fills parent) since this chart
   * lives inside the wide issue/channel drill-down cards.
   */
  maxWidthClass?: string;
}

function formatShortDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const chartConfig = {
  mentions: { label: "Mentions", color: "var(--chart-neutral)" },
} satisfies ChartConfig;

interface Point {
  date: string;
  mentions: number;
}

export function VolumeAreaChart({
  values,
  dates,
  windowDays = 7,
  maxWidthClass = "",
}: VolumeAreaChartProps) {
  if (values.length < 2) return null;

  const data: Point[] = values.map((v, i) => ({
    date: dates[i] ?? "",
    mentions: v,
  }));
  const peak = Math.max(...values);
  const trough = Math.min(...values);

  return (
    <div className={`w-full ${maxWidthClass}`}>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="fillVolume" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-mentions)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-mentions)" stopOpacity={0.02} />
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
            domain={[0, "auto"]}
            width={40}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            allowDecimals={false}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--chart-muted)" }}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(value) => formatShortDate(String(value))}
                formatter={(value) => (
                  <span className="font-semibold tabular-nums text-foreground">
                    {Number(value).toLocaleString()} mentions
                  </span>
                )}
              />
            }
          />
          <Area
            dataKey="mentions"
            type="monotone"
            stroke="var(--color-mentions)"
            strokeWidth={2}
            fill="url(#fillVolume)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ChartContainer>

      <div className="text-[10px] uppercase tracking-wider text-ink-faint mt-1 text-center">
        Peak{" "}
        <span className="tabular-nums text-ink-muted font-medium normal-case">
          {peak.toLocaleString()}
        </span>{" "}
        · Low{" "}
        <span className="tabular-nums text-ink-muted font-medium normal-case">
          {trough.toLocaleString()}
        </span>{" "}
        · rolling {windowDays}-day mention count
      </div>
    </div>
  );
}
