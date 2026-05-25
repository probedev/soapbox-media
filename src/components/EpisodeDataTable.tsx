"use client";

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  SlidersHorizontal,
  Search,
} from "lucide-react";

import type { EpisodeTableRow } from "@/lib/episodes";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── formatting + status helpers ───────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const LEAN: Record<string, { label: string; cls: string }> = {
  L: { label: "Left", cls: "bg-blue-100 text-blue-800" },
  M: { label: "Middle", cls: "bg-gray-100 text-gray-700" },
  R: { label: "Right", cls: "bg-red-100 text-red-800" },
};

type Stage = "done" | "failed" | "partial" | "pending" | "na";

const STATUS: Record<Stage, { label: string; dot: string }> = {
  done: { label: "Done", dot: "bg-emerald-500" },
  failed: { label: "Failed", dot: "bg-red-500" },
  partial: { label: "Partial", dot: "bg-amber-400" },
  pending: { label: "Pending", dot: "bg-gray-300" },
  na: { label: "Not applicable", dot: "bg-gray-200" },
};

const STAGE_RANK: Record<Stage, number> = {
  failed: 0,
  pending: 1,
  partial: 2,
  done: 3,
  na: 4,
};

function StatusDot({ state }: { state: Stage }) {
  const s = STATUS[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center">
          <span className={cn("h-2.5 w-2.5 rounded-full", s.dot)} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{s.label}</TooltipContent>
    </Tooltip>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-gray-500">
      {(["done", "failed", "partial", "pending"] as Stage[]).map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-full", STATUS[s].dot)} />
          {STATUS[s].label}
        </span>
      ))}
    </div>
  );
}

function SortHeader({
  label,
  column,
}: {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any;
}) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-1 text-[11px] uppercase tracking-wider font-medium text-muted-foreground hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="ml-1 h-3 w-3 shrink-0" />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-1 h-3 w-3 shrink-0" />
      ) : null}
    </Button>
  );
}

const stageSort = (rowA: any, rowB: any, id: string) =>
  STAGE_RANK[rowA.getValue(id) as Stage] - STAGE_RANK[rowB.getValue(id) as Stage];

// ── columns ────────────────────────────────────────────────────────────────

const COLUMN_LABELS: Record<string, string> = {
  political_lean: "Category",
  published_at: "Date",
  channel_name: "Channel",
  title: "Video",
  platform: "Type",
  duration_sec: "Length",
  transcribed: "Transcribed",
  classified: "Classified",
  scored: "Scored",
};

// Column widths as PERCENTAGES of the table (which is w-full). With
// `table-fixed`, percentages are relative to the table width, so they always
// sum to the container — the table never exceeds it and there's no horizontal
// scroll. (Pixel widths summing > container would force the table wider and
// scroll — that was the earlier bug.) Long cells truncate instead.
const COL_WIDTH: Record<string, number> = {
  political_lean: 9,
  published_at: 10,
  channel_name: 13,
  title: 23,
  platform: 7,
  duration_sec: 7,
  transcribed: 11,
  classified: 11,
  scored: 9,
};

const columns: ColumnDef<EpisodeTableRow>[] = [
  {
    accessorKey: "political_lean",
    header: ({ column }) => <SortHeader label="Category" column={column} />,
    cell: ({ row }) => {
      const lean = row.getValue("political_lean") as string;
      const l = LEAN[lean] ?? LEAN.M;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                l.cls,
              )}
            >
              {lean}
            </span>
          </TooltipTrigger>
          <TooltipContent>{l.label}</TooltipContent>
        </Tooltip>
      );
    },
  },
  {
    accessorKey: "published_at",
    header: ({ column }) => <SortHeader label="Date" column={column} />,
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums text-gray-600">
        {formatDate(row.getValue("published_at"))}
      </span>
    ),
  },
  {
    accessorKey: "channel_name",
    header: ({ column }) => <SortHeader label="Channel" column={column} />,
    cell: ({ row }) => (
      <a
        href={`/channels/${row.original.channel_id}`}
        title={row.getValue("channel_name") as string}
        className="block truncate text-gray-700 hover:text-gray-900 hover:underline"
      >
        {row.getValue("channel_name")}
      </a>
    ),
  },
  {
    accessorKey: "title",
    header: ({ column }) => <SortHeader label="Video" column={column} />,
    cell: ({ row }) => (
      <a
        href={row.original.source_url}
        target="_blank"
        rel="noopener noreferrer"
        title={row.getValue("title") as string}
        className="flex items-center gap-1 min-w-0 font-medium text-gray-900 hover:underline"
      >
        <span className="truncate">{row.getValue("title")}</span>
        <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" />
      </a>
    ),
  },
  {
    accessorKey: "platform",
    header: ({ column }) => <SortHeader label="Type" column={column} />,
    cell: ({ row }) => (
      <span className="text-[10px] uppercase tracking-wider text-gray-500">
        {row.getValue("platform") === "youtube" ? "YouTube" : "Podcast"}
      </span>
    ),
  },
  {
    accessorKey: "duration_sec",
    header: ({ column }) => <SortHeader label="Length" column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums text-gray-500">
        {formatDuration(row.getValue("duration_sec"))}
      </span>
    ),
  },
  {
    accessorKey: "transcribed",
    header: ({ column }) => <SortHeader label="Transcribed" column={column} />,
    cell: ({ row }) => <StatusDot state={row.getValue("transcribed") as Stage} />,
    sortingFn: stageSort,
  },
  {
    accessorKey: "classified",
    header: ({ column }) => <SortHeader label="Classified" column={column} />,
    cell: ({ row }) => <StatusDot state={row.getValue("classified") as Stage} />,
    sortingFn: stageSort,
  },
  {
    accessorKey: "scored",
    header: ({ column }) => <SortHeader label="Scored" column={column} />,
    cell: ({ row }) => <StatusDot state={row.getValue("scored") as Stage} />,
    sortingFn: stageSort,
  },
];

// ── table ────────────────────────────────────────────────────────────────

export function EpisodeDataTable({
  data,
  hideChannelColumns = false,
}: {
  data: EpisodeTableRow[];
  /** On a single-channel page, drop the redundant Category + Channel columns. */
  hideChannelColumns?: boolean;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "published_at", desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [search, setSearch] = React.useState("");

  const activeColumns = React.useMemo(
    () =>
      hideChannelColumns
        ? columns.filter(
            (c) =>
              (c as { accessorKey?: string }).accessorKey !== "political_lean" &&
              (c as { accessorKey?: string }).accessorKey !== "channel_name",
          )
        : columns,
    [hideChannelColumns],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.channel_name.toLowerCase().includes(q),
    );
  }, [data, search]);

  const table = useReactTable({
    data: filtered,
    columns: activeColumns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const { pageIndex, pageSize } = table.getState().pagination;
  const totalRows = table.getFilteredRowModel().rows.length;
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <TooltipProvider delayDuration={150}>
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search title or channel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={c.getIsVisible()}
                  onCheckedChange={(v) => c.toggleVisibility(!!v)}
                  className="capitalize"
                >
                  {COLUMN_LABELS[c.id] ?? c.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    className="text-[11px] uppercase tracking-wider overflow-hidden"
                    style={
                      COL_WIDTH[h.column.id]
                        ? { width: `${COL_WIDTH[h.column.id]}%` }
                        : undefined
                    }
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
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={activeColumns.length} className="h-24 text-center text-gray-500">
                  No episodes match your search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 mt-3 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span className="tabular-nums">
            {start.toLocaleString()}–{end.toLocaleString()} of{" "}
            {totalRows.toLocaleString()}
          </span>
          <Legend />
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
