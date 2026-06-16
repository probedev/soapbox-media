"use client";

/**
 * Depth panels (lower fold, pro/B2B):
 * - Ownership: lean x volume quadrant scatter (loud-left / loud-right / up-for-grabs).
 * - HeatGrid: issue x week salience heatmap (hue=lean, opacity=volume). Dense
 *   dual-encode with no Recharts equivalent - sanctioned hand-built.
 * - Momentum: reworked Risers/Faders - a clean diverging share-of-voice-delta bar.
 * - CrossTalk: who's named across shows this week (still the v1 hardcoded-name
 *   match - entity work is a separate follow-up).
 */
import * as React from "react";
import { Cell, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis, Bar, BarChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { OwnershipPoint, HeatRow, RiserRow, CrossTalkRow } from "@/lib/homelab";

const leanFill = (v: number) => (v > 0.05 ? "var(--chart-right)" : v < -0.05 ? "var(--chart-left)" : "var(--chart-neutral)");
const cfg = { v: { label: "value" } } satisfies ChartConfig;

// ── Ownership quadrant ─────────────────────────────────────────────────────
export function Ownership({ points }: { points: OwnershipPoint[] }) {
  if (points.length === 0) return <Empty label="Not enough issue volume yet." />;
  return (
    <div>
      <ChartContainer config={cfg} className="aspect-auto h-[300px] w-full">
        <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 16 }}>
          <ReferenceLine x={0} stroke="var(--chart-muted)" />
          <XAxis type="number" dataKey="lean" domain={[-10, 10]} ticks={[-10, -5, 0, 5, 10]}
            tickLine={false} axisLine={false} className="text-[10px]"
            label={{ value: "← Left   ·   Right →", position: "bottom", offset: 0, className: "text-[10px] fill-muted-foreground" }} />
          <YAxis type="number" dataKey="volume" scale="log" domain={["auto", "auto"]}
            tickLine={false} axisLine={false} width={30} className="text-[10px]"
            label={{ value: "volume", angle: -90, position: "insideLeft", className: "text-[10px] fill-muted-foreground" }} />
          <ZAxis type="number" dataKey="weight" range={[50, 500]} />
          <ChartTooltip content={<ChartTooltipContent
            formatter={(_v, _n, item) => {
              const p = item?.payload as OwnershipPoint;
              return `${p.issue} · ${p.volume} mentions · lean ${p.lean.toFixed(1)}`;
            }} />} />
          <Scatter data={points} isAnimationActive>
            {points.map((p, i) => <Cell key={i} fill={leanFill(p.lean)} fillOpacity={0.55} />)}
          </Scatter>
        </ScatterChart>
      </ChartContainer>
      <div className="text-[10px] text-muted-foreground text-center">bubble size = reach-weighted volume · higher = louder</div>
    </div>
  );
}

// ── Issue heat grid ────────────────────────────────────────────────────────
export function HeatGrid({ issues, weekLabels }: { issues: HeatRow[]; weekLabels: string[] }) {
  if (issues.length === 0) return <Empty label="No issue history yet." />;
  const maxVol = Math.max(1, ...issues.flatMap((r) => r.weeks.map((w) => w.vol)));
  const cellColor = (vol: number, lean: number | null) => {
    if (vol === 0 || lean == null) return "transparent";
    const op = Math.min(1, Math.max(0.06, Math.sqrt(vol / maxVol)));
    const [r, g, b] = lean > 0.5 ? [220, 38, 38] : lean < -0.5 ? [37, 99, 235] : [120, 120, 120];
    return `rgba(${r},${g},${b},${op})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th />
            {weekLabels.map((w) => <th key={w} className="font-normal text-ink-faint px-1 pb-1">{w}</th>)}
          </tr>
        </thead>
        <tbody>
          {issues.map((row) => (
            <tr key={row.issue}>
              <td className="pr-2 text-right text-ink-muted whitespace-nowrap max-w-[8rem] truncate">{row.issue}</td>
              {row.weeks.map((c, i) => (
                <td key={i} className="h-6 min-w-[1.75rem] rounded text-center align-middle tabular-nums"
                  style={{ backgroundColor: cellColor(c.vol, c.lean) }}
                  title={`${row.issue} · ${weekLabels[i]} · ${c.vol} mentions · lean ${c.lean?.toFixed(1) ?? "-"}`}>
                  {c.vol > maxVol * 0.25 ? <span className="text-white/90">{c.vol}</span> : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-muted-foreground mt-1.5">hue = lean (blue L / red R) · opacity = volume</div>
    </div>
  );
}

// ── Momentum (reworked Risers & Faders) ────────────────────────────────────
export function Momentum({ risers }: { risers: RiserRow[] }) {
  const data = React.useMemo(
    () => [...risers].sort((a, b) => Math.abs(b.shareDelta) - Math.abs(a.shareDelta)).slice(0, 12)
      .map((r) => ({ channel: r.channel, shareDelta: r.shareDelta, lean: r.lean, mentions: r.mentionsNow })),
    [risers],
  );
  if (data.length === 0) return <Empty label="No momentum to report yet." />;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.shareDelta)), 0.5);
  const fill = (lean: string) => (lean === "R" ? "var(--chart-right)" : lean === "L" ? "var(--chart-left)" : "var(--chart-neutral)");
  return (
    <div>
      <ChartContainer config={cfg} className="aspect-auto w-full" style={{ height: data.length * 26 + 16 }}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
          <XAxis type="number" domain={[-maxAbs, maxAbs]} hide />
          <YAxis type="category" dataKey="channel" width={130} tickLine={false} axisLine={false} className="text-[10px]" />
          <ReferenceLine x={0} stroke="var(--chart-muted)" />
          <ChartTooltip content={<ChartTooltipContent
            formatter={(_v, _n, item) => {
              const p = item?.payload as { shareDelta: number; mentions: number };
              return `${p.shareDelta > 0 ? "+" : ""}${p.shareDelta}% share · ${p.mentions} mentions this week`;
            }} />} />
          <Bar dataKey="shareDelta" radius={2} barSize={12} isAnimationActive>
            {data.map((d, i) => <Cell key={i} fill={fill(d.lean)} fillOpacity={d.shareDelta >= 0 ? 0.9 : 0.4} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="text-[10px] text-muted-foreground text-center">share-of-voice change vs last week · solid = rising, faded = fading</div>
    </div>
  );
}

// ── Cross-Talk ─────────────────────────────────────────────────────────────
export function CrossTalk({ rows }: { rows: CrossTalkRow[] }) {
  const data = rows.slice(0, 8);
  if (data.length === 0) return <Empty label="No cross-talk detected this week." />;
  const max = Math.max(1, ...data.map((r) => r.count));
  return (
    <div className="space-y-2.5">
      {data.map((r) => (
        <div key={r.who} className="text-xs">
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate font-medium text-ink-strong">{r.who}</span>
            <div className="relative h-3 flex-1 rounded bg-subtle overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded bg-ink-muted/70" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-ink-faint">{r.count}</span>
          </div>
          <div className="ml-30 pl-0 mt-0.5 text-[10px] text-ink-faint truncate">
            {r.by.slice(0, 3).map((b) => `${b.channel} (${b.n})`).join(" · ")}
          </div>
        </div>
      ))}
      <div className="text-[10px] text-muted-foreground pt-1">named by other shows · v1 name-match (entity detection is a follow-up)</div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-sm text-muted-foreground italic py-8 text-center">{label}</div>;
}
