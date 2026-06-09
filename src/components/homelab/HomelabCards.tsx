"use client";

/**
 * The 14 candidate home-page cards, rendered against live data on
 * /admin/homelab so the v1 cut can be chosen visually. Styling follows the
 * house chart conventions: red = right, blue = left, L+x/R+x labels.
 * These are decision mocks - production versions get snapshot-backed data
 * and polish, but the data shown here is real.
 */
import * as React from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap,
  XAxis, YAxis, ZAxis,
} from "recharts";

import type {
  BattlefieldRow, CrossTalkRow, FuseRow, GapRow, HeatRow, MegaphoneNode,
  OwnershipPoint, PlatformSplitRow, PolarBin, Pulse, Receipt, RiserRow,
  Strip, TwoConvPoint,
} from "@/lib/homelab";

const RED = "#dc2626";
const BLUE = "#2563eb";
const GRAY = "#9ca3af";

const fmtLean = (v: number | null) =>
  v === null ? "-" : v > 0.05 ? `R+${v.toFixed(1)}` : v < -0.05 ? `L+${Math.abs(v).toFixed(1)}` : "Even";
const leanColor = (v: number | null) => (v === null ? GRAY : v > 0.05 ? RED : v < -0.05 ? BLUE : GRAY);
const fmtReach = (x: number) => (x >= 1e6 ? (x / 1e6).toFixed(1) + "M" : Math.round(x / 1e3) + "k");

export function LabCard({ n, title, hook, children }: { n: number; title: string; hook: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm flex flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">
          <span className="text-gray-300 font-mono text-sm mr-2">#{n}</span>{title}
        </h3>
      </div>
      <p className="text-xs text-gray-500 mt-1 mb-4">{hook}</p>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

// #1 ─ Pulse
export function PulseCard({ d }: { d: Pulse }) {
  const stat = (label: string, value: string, delta?: number) => (
    <div className="border border-gray-100 rounded-md p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {delta !== undefined && (
        <div className={`text-xs mt-1 ${delta >= 0 ? "text-emerald-600" : "text-gray-400"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString()} vs prior week
        </div>
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {stat("episodes analyzed · 7d", d.episodes7d.toLocaleString(), d.episodesDelta)}
      {stat("issue mentions scored · 7d", d.mentions7d.toLocaleString(), d.mentionsDelta)}
      {stat("hours of audio · 7d", d.hours7d.toLocaleString())}
      {stat("channels on panel", d.channels.toLocaleString())}
    </div>
  );
}

// #2 ─ Battlefield
export function BattlefieldCard({ d }: { d: BattlefieldRow[] }) {
  return (
    <div className="space-y-2">
      {d.map((r) => {
        const lp = (r.leftW / r.total) * 100;
        return (
          <div key={r.issue} className="flex items-center gap-2 text-xs">
            <div className="w-36 truncate text-gray-700 text-right shrink-0">{r.issue}</div>
            <div className="flex-1 h-4 flex rounded overflow-hidden bg-gray-100">
              <div style={{ width: `${lp}%`, background: BLUE, opacity: 0.85 }} />
              <div style={{ width: `${100 - lp}%`, background: RED, opacity: 0.85 }} />
            </div>
            <div className="w-12 tabular-nums text-gray-400 shrink-0">{Math.round(lp)}/{Math.round(100 - lp)}</div>
          </div>
        );
      })}
      <div className="text-[10px] text-gray-400 pt-1">weighted share of left- vs right-aligned mentions · 7d · sorted by volume</div>
    </div>
  );
}

// #3 ─ Heat grid
export function HeatGridCard({ issues, weekLabels }: { issues: HeatRow[]; weekLabels: string[] }) {
  const maxVol = Math.max(...issues.flatMap((r) => r.weeks.map((c) => c.vol)), 1);
  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full">
        <thead>
          <tr>
            <th />
            {weekLabels.map((l) => <th key={l} className="font-normal text-gray-400 pb-1 px-0.5">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {issues.map((row) => (
            <tr key={row.issue}>
              <td className="pr-2 text-gray-700 whitespace-nowrap max-w-[150px] truncate">{row.issue}</td>
              {row.weeks.map((c, i) => {
                const intensity = Math.sqrt(c.vol / maxVol);
                const base = c.lean === null ? "156,163,175" : c.lean > 0.05 ? "220,38,38" : c.lean < -0.05 ? "37,99,235" : "107,114,128";
                return (
                  <td key={i} className="p-0.5">
                    <div
                      className="h-6 w-full rounded-sm flex items-center justify-center text-[9px] text-white/90"
                      style={{ background: `rgba(${base},${Math.max(intensity, 0.06)})` }}
                      title={`${row.issue} · wk of ${weekLabels[i]} · ${c.vol} mentions · ${fmtLean(c.lean)}`}
                    >
                      {c.vol > maxVol * 0.25 ? c.vol : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-400 pt-2">cell saturation = volume · hue = weekly lean · 8 weeks</div>
    </div>
  );
}

// #4 ─ Ownership map
export function OwnershipCard({ d }: { d: OwnershipPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis type="number" dataKey="lean" domain={[-10, 10]} tick={{ fontSize: 10 }} tickFormatter={(v) => fmtLean(v)} />
        <YAxis type="number" dataKey="volume" scale="log" domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={36} />
        <ZAxis type="number" dataKey="weight" range={[40, 600]} />
        <ReferenceLine x={0} stroke={GRAY} strokeDasharray="4 4" />
        <Tooltip content={({ payload }) => {
          const p = payload?.[0]?.payload as OwnershipPoint | undefined;
          return p ? (
            <div className="bg-white border border-gray-200 rounded px-2 py-1 text-xs shadow">
              <div className="font-medium">{p.issue}</div>
              <div>{fmtLean(p.lean)} · {p.volume} mentions · 30d</div>
            </div>
          ) : null;
        }} />
        <Scatter data={d}>
          {d.map((p, i) => <Cell key={i} fill={leanColor(p.lean)} fillOpacity={0.55} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// #5 ─ The Gap
export function GapCard({ d }: { d: GapRow[] }) {
  const min = -10, max = 10;
  const pos = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <div className="space-y-2.5">
      {d.map((r) => (
        <div key={r.issue} className="text-xs">
          <div className="flex items-center gap-2">
            <div className="w-36 truncate text-gray-700 text-right shrink-0">{r.issue}</div>
            <div className="flex-1 relative h-5">
              <div className="absolute inset-y-2 left-0 right-0 bg-gray-100 rounded" />
              <div className="absolute inset-y-2 bg-gray-300/60 rounded" style={{
                left: `${Math.min(pos(r.indep), pos(r.legacy))}%`,
                width: `${Math.abs(pos(r.indep) - pos(r.legacy))}%`,
              }} />
              <div className="absolute top-1/2 -translate-y-1/2 left-1/2 w-px h-4 bg-gray-300" />
              <div title={`legacy ${fmtLean(r.legacy)}`} className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow" style={{ left: `calc(${pos(r.legacy)}% - 5px)`, background: "#6b7280" }} />
              <div title={`independent ${fmtLean(r.indep)}`} className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow" style={{ left: `calc(${pos(r.indep)}% - 5px)`, background: leanColor(r.indep) }} />
            </div>
            <div className="w-14 tabular-nums text-gray-500 shrink-0">Δ{Math.abs(r.gap).toFixed(1)}</div>
          </div>
        </div>
      ))}
      <div className="text-[10px] text-gray-400 pt-1">
        <span className="inline-block w-2 h-2 rounded-full bg-gray-500 mr-1" />legacy ·{" "}
        <span className="inline-block w-2 h-2 rounded-full bg-red-600 mr-1" />independent (colored by side) · 30d · sorted by gap
      </div>
    </div>
  );
}

// #6 ─ Two conversations
export function TwoConvCard({ d }: { d: TwoConvPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={d} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
        <YAxis domain={[-4, 4]} tick={{ fontSize: 10 }} width={36} tickFormatter={(v) => fmtLean(v)} />
        <ReferenceLine y={0} stroke={GRAY} strokeDasharray="4 4" />
        <Tooltip formatter={(v: any, name: any) => [fmtLean(v), name]} labelFormatter={(l) => `7d window ending ${l}`} />
        <Area type="monotone" dataKey="independent" stroke="#111827" fill="#111827" fillOpacity={0.06} strokeWidth={2} connectNulls />
        <Area type="monotone" dataKey="legacy" stroke={GRAY} fill={GRAY} fillOpacity={0.08} strokeWidth={2} strokeDasharray="5 3" connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// #7 ─ Risers & faders
export function RisersCard({ d }: { d: RiserRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-gray-400 text-left">
          <th className="font-normal pb-1.5">channel</th>
          <th className="font-normal pb-1.5 text-right">share</th>
          <th className="font-normal pb-1.5 text-right">Δ share</th>
          <th className="font-normal pb-1.5 text-right">lean shift</th>
        </tr>
      </thead>
      <tbody>
        {d.map((r) => (
          <tr key={r.channel} className="border-t border-gray-100">
            <td className="py-1.5">
              <span className="font-medium text-gray-800">{r.channel}</span>
              <span className={`ml-1.5 text-[9px] px-1 rounded ${r.lean === "R" ? "bg-red-50 text-red-700" : r.lean === "L" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{r.lean}</span>
              <span className="ml-1 text-[9px] text-gray-400">{r.cohort === "legacy" ? "legacy" : ""} · {fmtReach(r.reach)}</span>
            </td>
            <td className="text-right tabular-nums text-gray-600">{r.shareNow}%</td>
            <td className={`text-right tabular-nums font-medium ${r.shareDelta > 0 ? "text-emerald-600" : "text-gray-400"}`}>
              {r.shareDelta > 0 ? "▲" : "▼"}{Math.abs(r.shareDelta)}
            </td>
            <td className="text-right tabular-nums" style={{ color: leanColor(r.leanShift > 0.1 ? 1 : r.leanShift < -0.1 ? -1 : null) }}>
              {r.leanShift > 0.1 ? "→R " : r.leanShift < -0.1 ? "←L " : ""}{Math.abs(r.leanShift).toFixed(1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// #8 ─ Megaphone treemap
function TreemapNode(props: any) {
  const { x, y, width, height, name, fill, mentions } = props;
  if (!width || !height || width < 4 || height < 4) return <g />;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.75} stroke="#fff" strokeWidth={1.5} rx={2} />
      {width > 70 && height > 28 && (
        <text x={x + 6} y={y + 16} fill="#fff" fontSize={10} fontWeight={600}>
          {String(name).slice(0, Math.floor(width / 6))}
        </text>
      )}
      {width > 70 && height > 44 && (
        <text x={x + 6} y={y + 30} fill="#fff" fontSize={9} fillOpacity={0.85}>{mentions} mentions</text>
      )}
    </g>
  );
}
export function MegaphoneCard({ d }: { d: MegaphoneNode[] }) {
  const data = d.map((n) => ({ ...n, fill: n.lean === "R" ? RED : n.lean === "L" ? BLUE : GRAY }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <Treemap data={data} dataKey="size" nameKey="name" stroke="#fff" content={<TreemapNode />} />
    </ResponsiveContainer>
  );
}

// #9 ─ Lit fuses
export function FusesCard({ d }: { d: FuseRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {d.map((f) => (
        <div key={f.issue} className="border border-gray-100 rounded-md p-3">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-medium text-gray-800 truncate pr-2">{f.issue}</div>
            <div className={`text-sm font-semibold tabular-nums ${f.ratio >= 1.5 ? "text-amber-600" : "text-gray-500"}`}>{f.ratio}×</div>
          </div>
          <div className="flex items-end gap-1 h-8 mt-2">
            {f.weekly.map((v, i) => {
              const max = Math.max(...f.weekly, 1);
              return <div key={i} className={`flex-1 rounded-sm ${i === 3 ? "bg-amber-500" : "bg-gray-200"}`} style={{ height: `${Math.max((v / max) * 100, 6)}%` }} title={`${v} mentions`} />;
            })}
          </div>
          <div className="text-[10px] text-gray-400 mt-1.5 truncate">most active: {f.firstMover}</div>
        </div>
      ))}
    </div>
  );
}

// #10 ─ Strips
export function StripsCard({ d }: { d: Strip[] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {d.map((s) => (
        <div key={s.issue} className="border border-gray-100 rounded-md p-2">
          <div className="text-[11px] font-medium text-gray-800 truncate">{s.issue}</div>
          <ResponsiveContainer width="100%" height={70}>
            <ComposedChart data={s.points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <Bar dataKey="vol" fill="#e5e7eb" />
              <ReferenceLine y={0} yAxisId="lean" stroke="#e5e7eb" />
              <YAxis hide />
              <YAxis hide yAxisId="lean" domain={[-6, 6]} />
              <Line yAxisId="lean" type="monotone" dataKey="lean" stroke={leanColor(s.points[s.points.length - 1]?.lean ?? null)} strokeWidth={1.8} dot={false} connectNulls />
              <XAxis dataKey="date" hide />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="text-[10px] tabular-nums" style={{ color: leanColor(s.points[s.points.length - 1]?.lean ?? null) }}>
            {fmtLean(s.points[s.points.length - 1]?.lean ?? null)}
          </div>
        </div>
      ))}
    </div>
  );
}

// #11 ─ Receipts
export function ReceiptsCard({ d }: { d: Receipt[] }) {
  return (
    <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
      {d.map((r, i) => (
        <div key={i} className="border-l-2 pl-3" style={{ borderColor: leanColor(r.sent) }}>
          <p className="text-xs text-gray-800 leading-relaxed">&ldquo;{r.quote.length > 220 ? r.quote.slice(0, 220) + "…" : r.quote}&rdquo;</p>
          <div className="text-[10px] text-gray-400 mt-1">
            <span className="font-medium text-gray-600">{r.channel}</span> · {r.issue} ·{" "}
            <span style={{ color: leanColor(r.sent) }}>{fmtLean(r.sent)}</span> · intensity {r.inten} ·{" "}
            <a href={r.url} className="underline" target="_blank" rel="noopener noreferrer">source</a>
          </div>
        </div>
      ))}
    </div>
  );
}

// #12 ─ Cross-talk
export function CrossTalkCard({ d }: { d: CrossTalkRow[] }) {
  const max = Math.max(...d.map((r) => r.count), 1);
  return (
    <div className="space-y-2">
      {d.map((r) => (
        <div key={r.who} className="text-xs">
          <div className="flex items-center gap-2">
            <div className="w-32 truncate font-medium text-gray-800 text-right shrink-0">{r.who}</div>
            <div className="flex-1 h-3.5 bg-gray-100 rounded overflow-hidden">
              <div className="h-full bg-gray-700 rounded" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <div className="w-8 tabular-nums text-gray-500 shrink-0">{r.count}</div>
          </div>
          <div className="ml-34 pl-[8.5rem] text-[10px] text-gray-400 truncate">
            by {r.by.map((b) => `${b.channel} (${b.n})`).join(" · ")}
          </div>
        </div>
      ))}
      <div className="text-[10px] text-gray-400 pt-1">times named inside scored quotes by OTHER shows · 30d · string-match v1</div>
    </div>
  );
}

// #13 ─ Polarization strip
export function PolarizationCard({ bins, pctExtreme, mentions }: { bins: PolarBin[]; pctExtreme: number; mentions: number }) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={bins} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <XAxis dataKey="bin" tick={{ fontSize: 9 }} ticks={[-5, -3, 0, 3, 5]} tickFormatter={(v) => fmtLean(v)} />
          <YAxis hide />
          <Tooltip formatter={(v: any) => [`${v} mentions`, ""]} labelFormatter={(l) => `sentiment ${l}`} />
          <Bar dataKey="count">
            {bins.map((b, i) => <Cell key={i} fill={leanColor(b.bin)} fillOpacity={0.35 + Math.min(Math.abs(b.bin) / 5, 1) * 0.55} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="text-xs text-gray-600 mt-2">
        <span className="font-semibold text-gray-900">{pctExtreme}%</span> of this week&apos;s {mentions.toLocaleString()} mentions
        sit beyond ±3 - the conversation is bimodal by nature; the valley in the middle is the finding.
      </div>
    </div>
  );
}

// #14 ─ Audio vs video
export function PlatformSplitCard({ d }: { d: PlatformSplitRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={d} layout="vertical" margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
        <XAxis type="number" domain={[-6, 6]} tick={{ fontSize: 10 }} tickFormatter={(v) => fmtLean(v)} />
        <YAxis type="category" dataKey="issue" width={130} tick={{ fontSize: 10 }} />
        <ReferenceLine x={0} stroke={GRAY} />
        <Tooltip formatter={(v: any, name: any) => [fmtLean(v), name]} />
        <Bar dataKey="podcast" name="podcast" fill="#111827" fillOpacity={0.75} barSize={8} radius={2} />
        <Bar dataKey="youtube" name="youtube" fill="#9ca3af" fillOpacity={0.9} barSize={8} radius={2} />
      </BarChart>
    </ResponsiveContainer>
  );
}
