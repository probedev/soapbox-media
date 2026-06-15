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
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDateET } from "@/lib/utils";
import type { EmergingIssue } from "@/lib/discovery";
import type { EmergingReceiptsResponse } from "@/app/api/emerging/[id]/receipts/route";

const COL_WIDTH: Record<string, string> = {
  expander: "3%",
  rank: "4%",
  movement: "6%",
  topicCount: "11%",
  episodeCount: "11%",
  channelCount: "11%",
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
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className="inline-flex items-center gap-1 flex-row-reverse hover:text-foreground"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="w-3 h-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="w-3 h-3" />
      ) : null}
    </button>
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

/** Source channel's editorial lean as a colored chip, matching the site convention
 *  (blue = Left, red = Right, gray = Middle). These off-taxonomy topics aren't
 *  scored, so we color by who is saying it rather than by a sentiment value. */
function leanChip(lean: string): { text: string; cls: string } {
  if (lean === "L") return { text: "L", cls: "bg-blue-100 text-blue-800" };
  if (lean === "R") return { text: "R", cls: "bg-red-100 text-red-800" };
  return { text: "M", cls: "bg-muted text-ink-body" };
}

/** Lazy-loaded episode receipts for one emerging-topic candidate. */
function ReceiptsPanel({
  candidateId,
  label,
  cohort,
}: {
  candidateId: string;
  label: string;
  cohort?: "independent" | "legacy";
}) {
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

  if (state.status === "loading") {
    return <div className="px-4 py-3 text-xs text-ink-faint">Loading receipts…</div>;
  }
  if (state.status === "error") {
    return <div className="px-4 py-3 text-xs text-red-600">Couldn&apos;t load receipts.</div>;
  }

  const { receipts } = state.data!;
  if (receipts.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">
        No quoted receipts available for this topic.
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-subtle/70 border-t border-muted">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5">
        Receipts · what shows actually said about {label}
      </div>
      <div className="space-y-2.5">
        {receipts.map((r, i) => {
          const chip = leanChip(r.lean);
          return (
            <div
              key={i}
              className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 text-xs"
            >
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
        issue. Chip shows the source channel&apos;s lean. Quotes are excerpts, never full transcripts.
      </p>
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
      <button
        type="button"
        onClick={row.getToggleExpandedHandler()}
        aria-label={row.getIsExpanded() ? "Hide receipts" : "Show receipts"}
        className="text-ink-faint hover:text-ink-body"
      >
        {row.getIsExpanded() ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>
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
    <TooltipProvider delayDuration={150}>
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
                      <ReceiptsPanel
                        candidateId={row.original.id}
                        label={row.original.label}
                        cohort={cohort}
                      />
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
    </TooltipProvider>
  );
}
