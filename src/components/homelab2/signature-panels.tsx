"use client";

/**
 * Signature panels for homelab2 - the slices only Soapbox can tell.
 * - TwoAmericas: the independent-vs-legacy story. A cohort index trend over time
 *   + a per-issue divergence "dumbbell" (the two cohorts' positions per issue,
 *   biggest gaps first). getGap already floors at >=10 mentions/cohort, so the
 *   thin legacy cohort can't generate noisy gaps.
 * - Breaking: the top emerging events with the v0.25.0 favorability + cohort
 *   coverage signal; the realtime "what's new" hook. Links to /emerging.
 */
import * as React from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Flame } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { favorabilityChipStyle, favorabilityLabel } from "@/lib/lean";
import { cn } from "@/lib/utils";
import type { TwoConvPoint, GapRow } from "@/lib/homelab";
import type { EmergingIssue } from "@/lib/discovery";

const trendCfg = {
  independent: { label: "Independent", color: "var(--chart-index)" },
  legacy: { label: "Legacy", color: "var(--chart-muted)" },
} satisfies ChartConfig;

const pos = (v: number) => `${((Math.max(-10, Math.min(10, v)) + 10) / 20) * 100}%`;

export function TwoAmericas({ twoConv, gap }: { twoConv: TwoConvPoint[]; gap: GapRow[] }) {
  const rows = gap.slice(0, 8);
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Cohort trend */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Index over time · independent vs legacy
        </div>
        <ChartContainer config={trendCfg} className="aspect-auto h-[220px] w-full">
          <LineChart data={twoConv} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <ReferenceLine y={0} stroke="var(--chart-muted)" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28}
              tickFormatter={(d) => String(d).slice(5)} className="text-[10px]" />
            <YAxis domain={[-10, 10]} ticks={[-10, 0, 10]} tickLine={false} axisLine={false} width={26} className="text-[10px]" />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Line dataKey="independent" type="monotone" stroke="var(--color-independent)" strokeWidth={2} dot={false} connectNulls isAnimationActive />
            <Line dataKey="legacy" type="monotone" stroke="var(--color-legacy)" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive />
          </LineChart>
        </ChartContainer>
        <div className="mt-1.5 flex gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[var(--chart-index)]" />Independent</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-[var(--chart-muted)]" />Legacy</span>
        </div>
      </div>

      {/* Per-issue divergence dumbbell (sanctioned 1-D position markers) */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Where they diverge most · per issue
        </div>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-8 text-center">Not enough cohort overlap yet.</div>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => {
              const lo = Math.min(r.indep, r.legacy), hi = Math.max(r.indep, r.legacy);
              return (
                <div key={r.issue} className="grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
                  <span className="truncate text-ink-muted">{r.issue}</span>
                  <div className="relative h-4">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-input" />
                    <div className="absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-input" />
                    {/* gap shading */}
                    <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-muted-foreground/20"
                      style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
                    {/* independent + legacy markers */}
                    <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--chart-index)]"
                      style={{ left: pos(r.indep) }} title={`Independent ${r.indep.toFixed(1)}`} />
                    <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--chart-muted)] bg-background"
                      style={{ left: pos(r.legacy) }} title={`Legacy ${r.legacy.toFixed(1)}`} />
                  </div>
                  <span className="tabular-nums text-right text-ink-faint">{Math.abs(r.gap).toFixed(1)}</span>
                </div>
              );
            })}
            <div className="text-[10px] text-muted-foreground flex justify-between pt-1">
              <span>← Left</span>
              <span>● independent · ○ legacy · number = gap</span>
              <span>Right →</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Breaking({ breaking }: { breaking: EmergingIssue[] }) {
  if (breaking.length === 0) return <div className="text-sm text-muted-foreground italic py-6 text-center">Nothing breaking right now.</div>;
  return (
    <div className="space-y-3">
      {breaking.map((e) => {
        const fav = favorabilityChipStyle(e.favorability);
        const cov = e.coverage;
        const tot = cov.L.mentions + cov.M.mentions + cov.R.mentions || 1;
        return (
          <a key={e.id} href="/emerging" className="block rounded-lg border border-border p-3 hover:bg-subtle transition">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-strong truncate">{e.label}</span>
                  {e.velocity.breaking && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      <Flame className="h-3 w-3" />{e.velocity.ratio ? `${e.velocity.ratio}x` : "new"}
                    </span>
                  )}
                </div>
                {e.summary && <div className="text-xs text-ink-muted mt-0.5 line-clamp-1">{e.summary}</div>}
              </div>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums", fav.cls)}>
                {e.favorability != null ? `${favorabilityLabel(e.favorability)} ${fav.text}` : "unscored"}
              </span>
            </div>
            {/* coverage mini-bar */}
            <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full">
              <div className="bg-blue-500" style={{ width: `${(cov.L.mentions / tot) * 100}%` }} />
              <div className="bg-muted-foreground/40" style={{ width: `${(cov.M.mentions / tot) * 100}%` }} />
              <div className="bg-red-500" style={{ width: `${(cov.R.mentions / tot) * 100}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-ink-faint tabular-nums">
              {tot} mentions · L {cov.L.mentions} / M {cov.M.mentions} / R {cov.R.mentions}
            </div>
          </a>
        );
      })}
      <a href="/emerging" className="block text-center text-xs text-ink-muted hover:text-ink-body pt-1">See the full emerging board →</a>
    </div>
  );
}
