"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AdTrendPoint } from "@/lib/aggregate";

/**
 * Monthly placement history for one advertiser: detected host-read sponsor
 * messages stacked by the carrying channel's lean. Diverging semantics on the
 * house palette (blue = left, red = right) with the house neutral gray for
 * middle - the same trio as IndexAreaChart's sideColor, validated against the
 * light surface (gray is the diverging midpoint, deliberately recessive; the
 * legend + tooltip carry identity, never color alone).
 */
const chartConfig = {
  left: { label: "Left-leaning shows", color: "#2563eb" },
  middle: { label: "Middle", color: "#6b7280" },
  right: { label: "Right-leaning shows", color: "#dc2626" },
} satisfies ChartConfig;

function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function AdvertiserTrendChart({ trend }: { trend: AdTrendPoint[] }) {
  if (trend.length < 2) return null;
  return (
    <ChartContainer config={chartConfig} className="min-h-[180px] w-full">
      <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonth}
          tickLine={false}
          axisLine={false}
          fontSize={11}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} width={44} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(v) => formatMonth(String(v))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {/* 1px surface stroke approximates the 2px spacer between stacked
            segments without a custom shape. */}
        <Bar dataKey="left" stackId="reads" fill="var(--color-left)" stroke="#fff" strokeWidth={1} />
        <Bar dataKey="middle" stackId="reads" fill="var(--color-middle)" stroke="#fff" strokeWidth={1} />
        <Bar
          dataKey="right"
          stackId="reads"
          fill="var(--color-right)"
          stroke="#fff"
          strokeWidth={1}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}
