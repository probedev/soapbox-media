"use client";

/**
 * Scale + landscape panels (trust / B2B):
 * - ScaleStrip: a clean "realtime feed" proof-of-scale row - episodes, mentions,
 *   hours of audio, channels - with week-over-week deltas and count-up on view.
 *   (Reintroduces the old Pulse concept in a far cleaner form.)
 * - ChannelLandscape: top channels by reach-weighted voice as a readable
 *   horizontal bar, colored by lean. (Reintroduces Megaphone, not as a treemap.)
 */
import * as React from "react";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useInView } from "./reveal";
import type { Pulse, MegaphoneNode } from "@/lib/homelab";

function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);
  return <span ref={ref} className="tabular-nums">{n.toLocaleString()}{suffix}</span>;
}

function Stat({ label, value, delta, suffix }: { label: string; value: number; delta?: number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="text-2xl font-semibold text-ink-strong"><CountUp value={value} suffix={suffix} /></div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {label}
        {delta != null && delta !== 0 && (
          <span className={delta > 0 ? "text-emerald-600" : "text-ink-faint"}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

export function ScaleStrip({ pulse, stats }: { pulse: Pulse; stats: { channels: number; episodes: number; mentions: number } }) {
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="episodes analyzed · 7d" value={pulse.episodes7d} delta={pulse.episodesDelta} />
        <Stat label="issue mentions scored · 7d" value={pulse.mentions7d} delta={pulse.mentionsDelta} />
        <Stat label="hours of audio · 7d" value={pulse.hours7d} />
        <Stat label="channels tracked" value={pulse.channels} />
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground tabular-nums">
        {stats.mentions.toLocaleString()} scored mentions across {stats.channels} channels, all time · refreshed continuously
      </div>
    </div>
  );
}

const cfg = { v: { label: "voice" } } satisfies ChartConfig;
const leanFill = (lean: string) => (lean === "R" ? "var(--chart-right)" : lean === "L" ? "var(--chart-left)" : "var(--chart-neutral)");

export function ChannelLandscape({ nodes }: { nodes: MegaphoneNode[] }) {
  const data = React.useMemo(() => nodes.slice(0, 15).map((n) => ({ name: n.name, size: n.size, lean: n.lean, mentions: n.mentions })), [nodes]);
  if (data.length === 0) return <div className="text-sm text-muted-foreground italic py-8 text-center">No channel activity yet.</div>;
  return (
    <div>
      <ChartContainer config={cfg} className="aspect-auto w-full" style={{ height: data.length * 24 + 16 }}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} className="text-[10px]" />
          <ChartTooltip content={<ChartTooltipContent
            formatter={(_v, _n, item) => {
              const p = item?.payload as { mentions: number; lean: string };
              return `${p.mentions} mentions this week · ${p.lean}`;
            }} />} />
          <Bar dataKey="size" radius={2} barSize={12} isAnimationActive>
            {data.map((d, i) => <Cell key={i} fill={leanFill(d.lean)} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="text-[10px] text-muted-foreground text-center">top channels by reach-weighted voice · 7d · color = lean</div>
    </div>
  );
}
