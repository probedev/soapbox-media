"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

interface IndexAreaChartProps {
  /** Soapbox Index values, oldest first. Range −10..+10. */
  values: number[];
  /** ISO date (YYYY-MM-DD) per value, same order/length. */
  dates: string[];
  /** Rolling-window length in days (for the caption). */
  windowDays?: number;
  /**
   * Tailwind max-width class for the chart container. Defaults to `max-w-md`
   * (the narrow home-page hero). Pass `""` to let it fill its parent — used in
   * the wide issue/channel drill-down cards.
   */
  maxWidthClass?: string;
  /**
   * Whether the vertical range must include 0 (the neutral line). True for the
   * home Index (so the L/R side is obvious). False for an issue/channel that
   * sits far from center — fit to the data so the line uses the full height
   * instead of leaving dead space.
   */
  includeZero?: boolean;
}

function formatLean(v: number): string {
  if (v > 0.05) return `R+${v.toFixed(1)}`;
  if (v < -0.05) return `L+${Math.abs(v).toFixed(1)}`;
  return "Even";
}

function formatShortDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function sideColor(v: number): string {
  return v > 0.05 ? "#ef4444" : v < -0.05 ? "#3b82f6" : "#6b7280";
}

const chartConfig = {
  index: { label: "Soapbox Index", color: "#374151" },
} satisfies ChartConfig;

interface Point {
  date: string;
  index: number;
}

function IndexTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <div className="text-gray-500">{formatShortDate(p.date)}</div>
      <div
        className="font-semibold tabular-nums"
        style={{ color: sideColor(p.index) }}
      >
        {formatLean(p.index)}
      </div>
    </div>
  );
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

  const minVal = formatLean(dataMin);
  const maxVal = formatLean(dataMax);

  return (
    <div className={`w-full ${maxWidthClass}`}>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="fillIndex" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#374151" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#374151" stopOpacity={0.02} />
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
            tickFormatter={(v: number) => formatLean(v)}
          />
          {includeZero && (
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="2 2" />
          )}
          <ChartTooltip cursor={{ stroke: "#d1d5db" }} content={<IndexTooltip />} />
          <Area
            dataKey="index"
            type="monotone"
            stroke="#374151"
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

      <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-1 text-center">
        Range{" "}
        <span className="tabular-nums text-gray-600 font-medium normal-case">{minVal}</span> to{" "}
        <span className="tabular-nums text-gray-600 font-medium normal-case">{maxVal}</span> ·
        rolling {windowDays}-day index
      </div>
    </div>
  );
}
