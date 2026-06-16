"use client";

/**
 * homelab2 hero - the anchor. Retains the master Soapbox Index needle + the two
 * cohort sub-needles, but gives EACH needle its own labeled trend (resolving the
 * old ambiguity where one sparkline sat under the sub-needles but plotted the
 * master), and adds one interactive index chart with a horizon toggle and the two
 * cohort lines overlaid - so "which line is which needle" is explicit.
 */
import * as React from "react";
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { SoapboxNeedle } from "@/components/SoapboxNeedle";
import { SubNeedle } from "@/components/SubNeedle";
import { Sparkline } from "@/components/ui/sparkline";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatLean, leanColor } from "@/lib/lean";
import { cn } from "@/lib/utils";

interface CohortTrend {
  index: number;
  sparkline: number[];
  dates: string[];
}

interface HeroProps {
  index: number;
  indexDelta: number;
  masterSparkline: number[];
  masterDates: string[];
  cohorts: { independent: CohortTrend; legacy: CohortTrend };
}

const sideColor = (v: number) => (v > 0.05 ? "var(--chart-right)" : v < -0.05 ? "var(--chart-left)" : "var(--chart-neutral)");

/** One needle + its own labeled trend, so the trend is unambiguously attributed. */
function NeedleWithTrend({
  label,
  value,
  values,
  big,
  delayMs,
}: {
  label: string;
  value: number;
  values: number[];
  big?: boolean;
  delayMs?: number;
}) {
  return (
    <div className="flex flex-col items-center">
      {big ? (
        <SoapboxNeedle value={value} width={300} height={190} animated delayMs={delayMs} />
      ) : (
        <SubNeedle label={label} value={value} hasData animated delayMs={delayMs} />
      )}
      {big && (
        <div className={cn("text-3xl font-semibold tabular-nums mt-1", leanColor(value))}>
          {formatLean(value)}
        </div>
      )}
      <div className="mt-2 flex flex-col items-center gap-1">
        {values.length >= 2 ? (
          <Sparkline values={values} color={sideColor(value)} domain={[-10, 10]} zeroLine width={big ? 160 : 120} height={28} />
        ) : (
          <div className="text-[10px] text-ink-faintest italic h-7 flex items-center">trend building</div>
        )}
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {big ? "Soapbox Index" : label} · {values.length}d trend
        </div>
      </div>
    </div>
  );
}

const HORIZONS = [7, 14, 30] as const;

const chartConfig = {
  master: { label: "Index", color: "var(--chart-index)" },
  independent: { label: "Independent", color: "var(--chart-neutral)" },
  legacy: { label: "Legacy", color: "var(--chart-muted)" },
} satisfies ChartConfig;

export function Hero({ index, indexDelta, masterSparkline, masterDates, cohorts }: HeroProps) {
  const [horizon, setHorizon] = React.useState<(typeof HORIZONS)[number]>(30);

  // Merge the three series by date (each skips empty days, so lengths differ).
  const merged = React.useMemo(() => {
    const byDate = new Map<string, { date: string; master: number | null; independent: number | null; legacy: number | null }>();
    const put = (dates: string[], vals: number[], key: "master" | "independent" | "legacy") => {
      dates.forEach((d, i) => {
        const row = byDate.get(d) ?? { date: d, master: null, independent: null, legacy: null };
        row[key] = vals[i] ?? null;
        byDate.set(d, row);
      });
    };
    put(masterDates, masterSparkline, "master");
    put(cohorts.independent.dates, cohorts.independent.sparkline, "independent");
    put(cohorts.legacy.dates, cohorts.legacy.sparkline, "legacy");
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [masterSparkline, masterDates, cohorts]);

  const series = merged.slice(-horizon);
  const deltaUp = indexDelta >= 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center">
      {/* Needles */}
      <div className="flex flex-col items-center gap-6">
        <NeedleWithTrend label="Soapbox Index" value={index} values={masterSparkline} big delayMs={0} />
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {deltaUp ? "▲" : "▼"} {Math.abs(indexDelta).toFixed(1)} since last week
        </div>
        <div className="grid grid-cols-2 gap-6 pt-2 border-t border-border w-full max-w-sm">
          <NeedleWithTrend label="Independent" value={cohorts.independent.index} values={cohorts.independent.sparkline} delayMs={140} />
          <NeedleWithTrend label="Legacy" value={cohorts.legacy.index} values={cohorts.legacy.sparkline} delayMs={260} />
        </div>
      </div>

      {/* Interactive index chart */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Index trend · master + cohorts
          </div>
          <div className="flex gap-1">
            {HORIZONS.map((h) => (
              <Button
                key={h}
                size="sm"
                variant={horizon === h ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px] tabular-nums"
                onClick={() => setHorizon(h)}
              >
                {h}d
              </Button>
            ))}
          </div>
        </div>
        <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
          <AreaChart data={series} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
            <defs>
              <linearGradient id="hl2-master" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-master)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-master)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <ReferenceLine y={0} stroke="var(--chart-muted)" strokeWidth={1} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28}
              tickFormatter={(d) => String(d).slice(5)} className="text-[10px]" />
            <YAxis domain={[-10, 10]} ticks={[-10, 0, 10]} tickLine={false} axisLine={false} width={26} className="text-[10px]" />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Area dataKey="master" type="monotone" stroke="var(--color-master)" strokeWidth={2} fill="url(#hl2-master)" connectNulls isAnimationActive />
            <Line dataKey="independent" type="monotone" stroke="var(--color-independent)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls isAnimationActive />
            <Line dataKey="legacy" type="monotone" stroke="var(--color-legacy)" strokeWidth={1.5} dot={false} strokeDasharray="1 3" connectNulls isAnimationActive />
          </AreaChart>
        </ChartContainer>
        <div className="mt-1.5 flex gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[var(--chart-index)]" />Index</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-[var(--chart-neutral)]" />Independent</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dotted border-[var(--chart-muted)]" />Legacy</span>
        </div>
      </div>
    </div>
  );
}
