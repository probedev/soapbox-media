"use client";

/**
 * Issue panels for homelab2.
 * - WhyIndex: the "why is the index here" diverging L/R contribution bar, reworked
 *   onto Recharts with mention count made PROMINENT (a bold number at each bar's
 *   outer end), not buried in footer text.
 * - TopIssues: reworked to LEAD WITH VOLUME - horizontal bars ranked by mention
 *   count, lean as bar color + a small label (the old card led with the slider).
 */
import * as React from "react";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { IssueContribution, IssueAggregate } from "@/lib/aggregate";

const leanFill = (v: number) => (v > 0.05 ? "var(--chart-right)" : v < -0.05 ? "var(--chart-left)" : "var(--chart-neutral)");
const leanLabel = (v: number) => (v > 0.05 ? `R+${v.toFixed(1)}` : v < -0.05 ? `L+${Math.abs(v).toFixed(1)}` : "0.0");

const cfg = { v: { label: "value" } } satisfies ChartConfig;

// ── Why the index is here ─────────────────────────────────────────────────
export function WhyIndex({ breakdown }: { breakdown: IssueContribution[] }) {
  const data = React.useMemo(
    () =>
      [...breakdown]
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 10)
        .map((d) => ({
          name: d.name,
          contribution: Number(d.contribution.toFixed(2)),
          mentions: d.numClassifications,
          sentiment: d.avgSentiment,
        })),
    [breakdown],
  );
  if (data.length === 0) return <Empty label="No scored issues in the window yet." />;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.contribution)), 1);

  const left = data.filter((d) => d.contribution < 0).slice(0, 3).map((d) => d.name);
  const right = data.filter((d) => d.contribution > 0).slice(0, 3).map((d) => d.name);

  return (
    <div>
      <p className="text-sm text-ink-muted mb-3">
        {left.length > 0 && <>Pulling <span className="text-blue-600 font-medium">left</span>: {left.join(", ")}. </>}
        {right.length > 0 && <>Pulling <span className="text-red-600 font-medium">right</span>: {right.join(", ")}.</>}
      </p>
      <ChartContainer config={cfg} className="aspect-auto w-full" style={{ height: data.length * 34 + 16 }}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 44, top: 4, bottom: 4 }}>
          <XAxis type="number" domain={[-maxAbs, maxAbs]} hide />
          <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false}
            className="text-[11px]" tick={{ fill: "var(--color-ink-muted, currentColor)" }} />
          <ReferenceLine x={0} stroke="var(--chart-muted)" />
          <ChartTooltip content={<ChartTooltipContent
            formatter={(_v, _n, item) => {
              const p = item?.payload as { mentions: number; sentiment: number; contribution: number };
              return `${p.mentions} mentions · ${leanLabel(p.sentiment)} avg · push ${p.contribution > 0 ? "+" : ""}${p.contribution}`;
            }} />} />
          <Bar dataKey="contribution" radius={3} barSize={16} isAnimationActive>
            {data.map((d, i) => (
              <Cell key={i} fill={d.contribution < 0 ? "var(--chart-left)" : "var(--chart-right)"} />
            ))}
            <LabelList content={(p: any) => {
              const d = data[p.index];
              if (!d) return null;
              const neg = d.contribution < 0;
              const lx = neg ? p.x - 6 : p.x + p.width + 6;
              return (
                <text x={lx} y={p.y + p.height / 2} dy={4} textAnchor={neg ? "end" : "start"}
                  className="fill-foreground text-[11px] font-semibold tabular-nums">{d.mentions}</text>
              );
            }} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="mt-1 text-[10px] text-muted-foreground flex justify-between">
        <span>← Pulls L</span><span>bold number = mentions</span><span>Pulls R →</span>
      </div>
    </div>
  );
}

// ── Top issues (volume-led) ────────────────────────────────────────────────
export function TopIssues({ issues }: { issues: IssueAggregate[] }) {
  const data = React.useMemo(
    () =>
      [...issues]
        .sort((a, b) => b.numClassifications - a.numClassifications)
        .slice(0, 10)
        .map((d) => ({ name: d.name, mentions: d.numClassifications, lean: d.lean })),
    [issues],
  );
  if (data.length === 0) return <Empty label="No issues in the window yet." />;

  return (
    <div>
      <ChartContainer config={cfg} className="aspect-auto w-full" style={{ height: data.length * 34 + 16 }}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} className="text-[11px]" />
          <ChartTooltip content={<ChartTooltipContent
            formatter={(_v, _n, item) => {
              const p = item?.payload as { mentions: number; lean: number };
              return `${p.mentions.toLocaleString()} mentions · ${leanLabel(p.lean)}`;
            }} />} />
          <Bar dataKey="mentions" radius={3} barSize={16} isAnimationActive>
            {data.map((d, i) => <Cell key={i} fill={leanFill(d.lean)} />)}
            <LabelList content={(p: any) => {
              const d = data[p.index];
              if (!d) return null;
              return (
                <text x={p.x + p.width + 6} y={p.y + p.height / 2} dy={4} textAnchor="start"
                  className="fill-foreground text-[11px] font-semibold tabular-nums">
                  {d.mentions.toLocaleString()}
                </text>
              );
            }} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="mt-1 text-[10px] text-muted-foreground text-right">bar length = mentions · color = lean</div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-sm text-muted-foreground italic py-8 text-center">{label}</div>;
}
