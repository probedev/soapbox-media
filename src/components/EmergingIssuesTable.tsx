"use client";

/**
 * EmergingIssuesTable - the public /emerging board. A sortable TanStack table of
 * auto-detected, machine-clustered topics not yet in the taxonomy, each row
 * expandable to reveal real episode receipts (lazy-loaded from
 * /api/emerging/[id]/receipts). Mirrors the expand-for-receipts design used by
 * EpisodeDataTable / EpisodeMentions; promotion into a tracked issue stays
 * human-gated in /admin/discovery.
 */
import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUp, ArrowDown, ChevronDown, ChevronRight, ExternalLink, Flame, Minus } from "lucide-react";
import { Line, LineChart, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDateET } from "@/lib/utils";
import { leanChipStyle, favorabilityChipStyle, favorabilityLabel } from "@/lib/lean";
import type { EmergingIssue, Coverage, CohortPoint } from "@/lib/discovery";
import type { EmergingReceiptsResponse } from "@/app/api/emerging/[id]/receipts/route";

const COL_WIDTH: Record<string, string> = {
  expander: "3%",
  rank: "4%",
  movement: "6%",
  topicCount: "10%",
  episodeCount: "10%",
  channelCount: "10%",
  reaction: "13%",
};
const RIGHT_COLS = new Set(["topicCount", "episodeCount", "channelCount"]);

function SortHeader({
  column,
  label,
}: {
  column: import("@tanstack/react-table").Column<EmergingIssue, unknown>;
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className="h-auto gap-1 p-0 flex-row-reverse text-[11px] font-medium uppercase tracking-wider hover:bg-transparent hover:text-foreground"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="w-3 h-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="w-3 h-3" />
      ) : null}
    </Button>
  );
}

function formatDate(iso: string): string {
  return formatDateET(iso, { month: "short", day: "numeric", year: "numeric" });
}

/** Per-row freshness: how recently this issue was last mentioned. The board ranks
 *  on decayed volume, so showing the latest-mention date makes each row's currency
 *  explicit (and a genuinely stale topic obvious) instead of leaving it implied. */
function LatestMention({ iso }: { iso: string | null }) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  const rel = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mt-1 block w-fit cursor-default text-[11px] text-ink-faint tabular-nums">
          Last mentioned {rel}
        </span>
      </TooltipTrigger>
      <TooltipContent>Most recent mention: {formatDate(iso)}</TooltipContent>
    </Tooltip>
  );
}

const LEAN_LABEL: Record<"L" | "M" | "R", string> = { L: "Left", M: "Middle", R: "Right" };

/** Text color for a favorability value - emerald (favorable) / slate (critical) /
 *  faint (neutral). Deliberately NOT the red/blue L/R palette. */
function favColor(v: number): string {
  if (v > 0.25) return "text-emerald-700";
  if (v < -0.25) return "text-slate-600";
  return "text-ink-faint";
}

/**
 * Compact favorability gauge: how critical (left) vs. favorable (right) the
 * conversation is toward the topic. A SEPARATE axis from the L/R needle, so it
 * gets its own neutral-to-emerald track + dark marker (never red/blue). Shows
 * "unscored" until the topic is in the scored top-N.
 */
function FavorabilityGauge({
  value,
  scoredCount,
}: {
  value: number | null;
  scoredCount: number;
}) {
  if (value == null) {
    return <span className="text-[11px] text-ink-faint italic">unscored</span>;
  }
  const pct = ((value + 5) / 10) * 100; // -5..+5 -> 0..100%
  const valueText = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-24 cursor-default flex-col gap-1">
          <div className="relative h-1.5 rounded-full bg-gradient-to-r from-slate-300 via-muted to-emerald-300">
            <span
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground"
              style={{ left: `${pct}%` }}
            />
          </div>
          <span className={cn("text-[10px] font-medium tabular-nums", favColor(value))}>
            {favorabilityLabel(value)} {valueText}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Favorability {valueText} on a -5 (critical) to +5 (favorable) scale,
        reach-weighted across {scoredCount} scored mention{scoredCount === 1 ? "" : "s"}.
        Distinct from the channel-lean coverage below.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Cohort coverage = share of voice by channel lean (who is amplifying the topic).
 * Uses the L/R blue/red palette on purpose: this IS the lean axis. Normalized to
 * mentions-per-active-channel so it can't be skewed by how many of each lean we
 * track (we track more Right channels than Left, yet Left can still out-mention).
 */
function CoverageBar({ coverage }: { coverage: Coverage }) {
  const total = coverage.L.mentions + coverage.M.mentions + coverage.R.mentions;
  if (total === 0) return null;
  const seg: { key: "L" | "M" | "R"; n: number; cls: string }[] = [
    { key: "L", n: coverage.L.mentions, cls: "bg-blue-500" },
    { key: "M", n: coverage.M.mentions, cls: "bg-muted-foreground/40" },
    { key: "R", n: coverage.R.mentions, cls: "bg-red-500" },
  ];
  // Normalized amplification headline: dominant lean vs. the quietest, when clear.
  const ranked = (["L", "M", "R"] as const)
    .map((k) => ({ k, v: coverage[k].perChannel }))
    .sort((a, b) => b.v - a.v);
  const topLean = ranked[0];
  const botLean = ranked[ranked.length - 1];
  const ratio = botLean.v > 0 ? topLean.v / botLean.v : null;
  const headline =
    ratio && ratio >= 1.5
      ? `${LEAN_LABEL[topLean.k]} amplifying ${ratio.toFixed(1)}x vs ${LEAN_LABEL[botLean.k]}`
      : null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        Coverage by cohort · who&apos;s amplifying
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {seg.map((s) =>
          s.n === 0 ? null : (
            <Tooltip key={s.key}>
              <TooltipTrigger asChild>
                <div className={cn("h-full cursor-default", s.cls)} style={{ width: `${(s.n / total) * 100}%` }} />
              </TooltipTrigger>
              <TooltipContent>
                {LEAN_LABEL[s.key]}: {s.n} of {total} mentions ({((s.n / total) * 100).toFixed(0)}%),{" "}
                {coverage[s.key].perChannel} per active channel
              </TooltipContent>
            </Tooltip>
          ),
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ink-faint tabular-nums">
        <span>{total} mentions</span>
        <span>
          per active channel: <span className="text-blue-700">L {coverage.L.perChannel}</span> ·{" "}
          M {coverage.M.perChannel} · <span className="text-red-700">R {coverage.R.perChannel}</span>
        </span>
        {headline && <span className="font-medium text-ink-muted">{headline}</span>}
      </div>
    </div>
  );
}

const cohortTrendConfig = {
  L: { label: "Left", color: "var(--chart-left)" },
  M: { label: "Middle", color: "var(--chart-neutral)" },
  R: { label: "Right", color: "var(--chart-right)" },
} satisfies ChartConfig;

/** Cohort-over-time: daily mentions by lean. Decorative mini multi-line (no axes,
 *  no tooltip) - shows the shape of how each cohort picked the topic up. */
function CohortTrend({ series }: { series: CohortPoint[] }) {
  if (series.length < 2) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        Coverage over time
      </div>
      <ChartContainer config={cohortTrendConfig} className="aspect-auto h-12 w-full">
        <LineChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[0, "auto"]} />
          {(["L", "M", "R"] as const).map((k) => (
            <Line
              key={k}
              dataKey={k}
              type="monotone"
              stroke={`var(--color-${k})`}
              strokeWidth={1.5}
              strokeLinecap="round"
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

/** Lazy-loaded episode receipts for one emerging-topic candidate. */
function ReceiptsPanel({
  issue,
  cohort,
}: {
  issue: EmergingIssue;
  cohort?: "independent" | "legacy";
}) {
  const { id: candidateId, label } = issue;
  const [state, setState] = React.useState<{
    status: "loading" | "error" | "done";
    data?: EmergingReceiptsResponse;
  }>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    const url = cohort
      ? `/api/emerging/${candidateId}/receipts?cohort=${cohort}`
      : `/api/emerging/${candidateId}/receipts`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: EmergingReceiptsResponse) => {
        if (!cancelled) setState({ status: "done", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId, cohort]);

  const receiptsBody = (() => {
    if (state.status === "loading") {
      return <div className="text-xs text-ink-faint">Loading receipts…</div>;
    }
    if (state.status === "error") {
      return <div className="text-xs text-red-600">Couldn&apos;t load receipts.</div>;
    }
    const { receipts } = state.data!;
    if (receipts.length === 0) {
      return (
        <div className="text-xs text-muted-foreground italic">
          No quoted receipts available for this topic.
        </div>
      );
    }
    return (
      <>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5">
          Receipts · what shows actually said about {label}
        </div>
        <div className="space-y-2.5">
          {receipts.map((r, i) => {
            const chip = leanChipStyle(r.lean);
            const favChip = r.favorability != null ? favorabilityChipStyle(r.favorability) : null;
            return (
              <div
                key={i}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 text-xs"
              >
                <div className="flex flex-col items-stretch gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "inline-flex cursor-default items-center justify-center rounded px-1.5 py-0.5 font-semibold",
                          chip.cls,
                        )}
                      >
                        {chip.text}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {r.channel} ({chip.text})
                    </TooltipContent>
                  </Tooltip>
                  {favChip && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "inline-flex cursor-default items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                            favChip.cls,
                          )}
                        >
                          {favChip.text}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Favorability {(r.favorability as number).toFixed(1)} toward this topic
                        (-5 critical .. +5 favorable)
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="min-w-0">
                  <span className="text-ink-muted leading-snug">
                    <span className="text-ink-faint">&ldquo;</span>
                    {r.quote}
                    <span className="text-ink-faint">&rdquo;</span>
                  </span>
                  <a
                    href={r.episodeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1.5 text-ink-faint hover:text-ink-body"
                  >
                    <span className="font-medium text-ink-muted shrink-0">{r.channel}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{r.episodeTitle}</span>
                    <span className="tabular-nums shrink-0">· {formatDate(r.publishedAt)}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-ink-faint mt-3">
          Auto-detected and machine-clustered from off-taxonomy mentions; not yet a tracked Soapbox
          issue. The blue/red chip is the source channel&apos;s lean (who&apos;s talking); the
          second chip is the quote&apos;s favorability toward the topic (what they said). Quotes are
          excerpts, never full transcripts.
        </p>
      </>
    );
  })();

  return (
    <div className="px-4 py-3 bg-subtle/70 border-t border-muted space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Reaction · how it&apos;s landing
          </div>
          {issue.favorability != null ? (
            <div className="space-y-1">
              <FavorabilityGauge value={issue.favorability} scoredCount={issue.scoredCount} />
              <div className="text-[10px] text-ink-faint">
                based on {issue.scoredCount} of {issue.topicCount} mentions
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-ink-faint italic">
              Not yet scored - only the top trending topics get a favorability read.
            </div>
          )}
          <CohortTrend series={issue.cohortSeries} />
        </div>
        <CoverageBar coverage={issue.coverage} />
      </div>
      <div>{receiptsBody}</div>
    </div>
  );
}

/** Up/down movement on the ranking vs the previous daily refresh. Climbing is
 *  emerald (the house positive-delta color); slipping is muted, not alarm-red
 *  (red is reserved for "Right" lean site-wide). "new" = just entered the board. */
function MovementCell({ m }: { m: EmergingIssue["movement"] }) {
  if (m.status === "new") {
    return (
      <Badge
        variant="secondary"
        className="h-4 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
      >
        new
      </Badge>
    );
  }
  if (m.status === "up") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default items-center gap-0.5 font-medium tabular-nums text-emerald-600">
            <ArrowUp className="h-3 w-3" aria-hidden />
            {m.delta}
          </span>
        </TooltipTrigger>
        <TooltipContent>Up {m.delta} from #{m.prevRank} last refresh</TooltipContent>
      </Tooltip>
    );
  }
  if (m.status === "down") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default items-center gap-0.5 font-medium tabular-nums text-muted-foreground">
            <ArrowDown className="h-3 w-3" aria-hidden />
            {m.delta}
          </span>
        </TooltipTrigger>
        <TooltipContent>Down {m.delta} from #{m.prevRank} last refresh</TooltipContent>
      </Tooltip>
    );
  }
  if (m.status === "same") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default text-ink-faint">
            <Minus className="h-3 w-3" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>No change since last refresh</TooltipContent>
      </Tooltip>
    );
  }
  return null; // "none" - no prior snapshot to compare against yet
}

/** "Breaking" badge: shown when an issue's attention roughly doubled (or appeared
 *  fresh) week-over-week. Amber/flame, deliberately NOT red (red = "Right" lean
 *  site-wide). Surfaces what's accelerating now, distinct from rank movement. */
function BreakingBadge({ v }: { v: EmergingIssue["velocity"] }) {
  if (!v.breaking) return null;
  const label = v.ratio ? `${v.ratio}×` : "new";
  const tip = v.ratio
    ? `Breaking: ${v.recent7} mentions this week vs ${v.prior7} last week (${v.ratio}×)`
    : `Breaking: ${v.recent7} mentions this week, none the week before`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 cursor-default items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          <Flame className="h-3 w-3" aria-hidden />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

const columns: ColumnDef<EmergingIssue>[] = [
  {
    id: "expander",
    header: "",
    enableSorting: false,
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="icon"
        onClick={row.getToggleExpandedHandler()}
        aria-label={row.getIsExpanded() ? "Hide receipts" : "Show receipts"}
        className="h-6 w-6 text-ink-faint hover:bg-transparent hover:text-ink-body"
      >
        {row.getIsExpanded() ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </Button>
    ),
  },
  {
    id: "rank",
    header: "#",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="tabular-nums font-semibold text-ink-muted">{row.original.rank}</div>
    ),
  },
  {
    id: "movement",
    header: "",
    enableSorting: false,
    cell: ({ row }) => <MovementCell m={row.original.movement} />,
  },
  {
    accessorKey: "label",
    header: "Emerging issue",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink-strong">{row.original.label}</span>
          <BreakingBadge v={row.original.velocity} />
        </div>
        {row.original.summary && (
          <div className="text-xs text-ink-muted mt-0.5">{row.original.summary}</div>
        )}
        <LatestMention iso={row.original.latestMention} />
      </div>
    ),
  },
  {
    accessorKey: "topicCount",
    header: ({ column }) => <SortHeader column={column} label="Mentions" />,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-ink-muted">
        {row.original.topicCount.toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "episodeCount",
    header: ({ column }) => <SortHeader column={column} label="Episodes" />,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-ink-muted">
        {row.original.episodeCount.toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "channelCount",
    header: ({ column }) => <SortHeader column={column} label="Channels" />,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-ink-muted">
        {row.original.channelCount.toLocaleString()}
      </div>
    ),
  },
  {
    id: "reaction",
    header: () => <span className="text-[11px] uppercase tracking-wider">Reaction</span>,
    enableSorting: false,
    cell: ({ row }) => (
      <FavorabilityGauge value={row.original.favorability} scoredCount={row.original.scoredCount} />
    ),
  },
];

export function EmergingIssuesTable({
  data,
  cohort,
}: {
  data: EmergingIssue[];
  cohort?: "independent" | "legacy";
}) {
  // Default to the server's emerging-rank order (volume x momentum); columns stay
  // click-sortable for ad-hoc exploration (e.g. by mentions).
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [expanded, setExpanded] = React.useState<ExpandedState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead
                  key={h.id}
                  className={cn(
                    "text-[11px] uppercase tracking-wider",
                    RIGHT_COLS.has(h.column.id) && "text-right",
                  )}
                  style={COL_WIDTH[h.column.id] ? { width: COL_WIDTH[h.column.id] } : undefined}
                >
                  {h.isPlaceholder
                    ? null
                    : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <React.Fragment key={row.id}>
                <TableRow>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
                {row.getIsExpanded() && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                      <ReceiptsPanel issue={row.original} cohort={cohort} />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                No emerging issues right now. Check back after the next refresh.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
