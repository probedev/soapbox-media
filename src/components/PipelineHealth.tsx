import type { UsageLogRow } from "@/lib/usage";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Public pipeline-health view for /log. Renders two things from usage_log:
 *   1. a last-N-runs grid (stage × run, green/amber/red/idle) for at-a-glance
 *      issue spotting, and
 *   2. a detailed recent-runs table with per-stage counts.
 * Deliberately shows NO cost/token data - that stays on the operator-only
 * /admin/costs dashboard. This page is about "is the machine healthy."
 */

type StageStatus = "ok" | "warn" | "fail" | "idle";
type Stage = "ingest" | "transcribe" | "classify" | "score";

const STAGES: { key: Stage; label: string }[] = [
  { key: "ingest", label: "Ingest" },
  { key: "transcribe", label: "Transcribe" },
  { key: "classify", label: "Classify" },
  { key: "score", label: "Score" },
];

const CELL_CLASS: Record<StageStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-400",
  fail: "bg-red-500",
  idle: "bg-border",
};

const STATUS_BADGE: Record<StageStatus, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  fail: "bg-red-100 text-red-800",
  idle: "bg-muted text-ink-muted",
};

/** Did a stage throw? raw_summary holds the per-stage `ok` boolean. */
function stageThrew(row: UsageLogRow, stage: Stage): boolean {
  const s = row.raw_summary as any;
  const v = s?.stages?.[stage]?.ok;
  return v === false;
}

function ingestStatus(row: UsageLogRow): StageStatus {
  if (stageThrew(row, "ingest")) return "fail";
  if ((row.ingest_failures || 0) > 0) return "warn";
  if ((row.ingest_episodes_new || 0) === 0 && (row.ingest_episodes_fetched || 0) === 0)
    return "idle";
  return "ok";
}

function transcribeStatus(row: UsageLogRow): StageStatus {
  if (stageThrew(row, "transcribe")) return "fail";
  const ok = row.transcribe_succeeded || 0;
  const bad = row.transcribe_failed || 0;
  if (ok === 0 && bad === 0) return "idle";
  if (ok === 0 && bad > 0) return "fail";
  if (bad > 0) return "warn";
  return "ok";
}

function classifyStatus(row: UsageLogRow): StageStatus {
  if (stageThrew(row, "classify")) return "fail";
  if ((row.classify_failures || 0) > 0) return "warn";
  if ((row.classify_processed || 0) === 0) return "idle";
  return "ok";
}

function scoreStatus(row: UsageLogRow): StageStatus {
  if (stageThrew(row, "score")) return "fail";
  const ok = row.score_succeeded || 0;
  const bad = row.score_failed || 0;
  if (ok === 0 && bad === 0) return "idle";
  if (ok === 0 && bad > 0) return "fail";
  if (bad > 0) return "warn";
  return "ok";
}

function stageStatus(row: UsageLogRow, stage: Stage): StageStatus {
  switch (stage) {
    case "ingest":
      return ingestStatus(row);
    case "transcribe":
      return transcribeStatus(row);
    case "classify":
      return classifyStatus(row);
    case "score":
      return scoreStatus(row);
  }
}

/** Worst stage status drives the overall run health (idle is benign). */
function runStatus(row: UsageLogRow): StageStatus {
  if (row.error_message) return "fail";
  const rank: Record<StageStatus, number> = { idle: 0, ok: 1, warn: 2, fail: 3 };
  let worst: StageStatus = "ok";
  for (const { key } of STAGES) {
    const s = stageStatus(row, key);
    if (rank[s] > rank[worst]) worst = s;
  }
  return worst;
}

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_WORD: Record<StageStatus, string> = {
  ok: "healthy",
  warn: "degraded",
  fail: "failing",
  idle: "idle",
};

export function PipelineHealth({ runs }: { runs: UsageLogRow[] }) {
  if (!runs || runs.length === 0) {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          Pipeline health
        </h2>
        <p className="text-sm text-muted-foreground mt-3">No pipeline runs recorded yet.</p>
      </Card>
    );
  }

  // runs come most-recent-first.
  const latest = runs[0];
  const latestStatus = runStatus(latest);
  const tableRuns = runs.slice(0, 20);

  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          Pipeline health
        </h2>
        <span className="text-[11px] text-muted-foreground flex items-center gap-2">
          <span>Last run {relTime(latest.ran_at)}</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[latestStatus]}`}
          >
            {STATUS_WORD[latestStatus]}
          </span>
        </span>
      </div>

      {/* Per-stage status cards - current health of each stage, in words,
          with a small last-7-run trend strip. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STAGES.map(({ key, label }) => {
          const cur = stageStatus(latest, key);
          const recent = runs.slice(0, 7); // most-recent-first
          const okCount = recent.filter((r) => stageStatus(r, key) === "ok").length;
          const trend = [...recent].reverse(); // oldest → newest, left → right
          return (
            <div key={key} className="border border-border rounded-md p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${CELL_CLASS[cur]}`} />
                <span className="text-sm font-semibold capitalize text-foreground">
                  {STATUS_WORD[cur]}
                </span>
              </div>
              <div className="flex gap-1 mt-2.5">
                {trend.map((r) => {
                  const s = stageStatus(r, key);
                  return (
                    <span
                      key={r.id}
                      className={`w-2.5 h-2.5 rounded-md ${CELL_CLASS[s]}`}
                      title={`${shortDate(r.ran_at)} ${shortTime(r.ran_at)} - ${STATUS_WORD[s]}`}
                    />
                  );
                })}
              </div>
              <div className="text-[10px] text-ink-faint mt-2">
                {okCount} of last {recent.length} runs healthy
              </div>
            </div>
          );
        })}
      </div>

      {/* Detailed recent-runs table */}
      <div className="mt-6 overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="text-muted-foreground text-left border-b border-border hover:bg-transparent">
              <TableHead className="font-medium py-2 pr-3 h-auto text-muted-foreground">When</TableHead>
              <TableHead className="font-medium py-2 pr-3 h-auto text-muted-foreground">Source</TableHead>
              <TableHead className="font-medium py-2 pr-3 h-auto text-muted-foreground">Ingest</TableHead>
              <TableHead className="font-medium py-2 pr-3 h-auto text-muted-foreground">Transcribe</TableHead>
              <TableHead className="font-medium py-2 pr-3 h-auto text-muted-foreground">Classify</TableHead>
              <TableHead className="font-medium py-2 pr-3 h-auto text-muted-foreground">Score</TableHead>
              <TableHead className="font-medium py-2 pr-3 h-auto text-muted-foreground">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {tableRuns.map((row) => {
              const rs = runStatus(row);
              const tFail = (row.transcribe_failed || 0) > 0;
              const sFail = (row.score_failed || 0) > 0;
              const cFail = (row.classify_failures || 0) > 0;
              const iFail = (row.ingest_failures || 0) > 0;
              return (
                <TableRow key={row.id} className="border-b border-muted align-top hover:bg-transparent">
                  <TableCell className="py-2 pr-3 whitespace-nowrap">
                    <span className="text-foreground">{relTime(row.ran_at)}</span>
                    <span className="text-ink-faint ml-1">
                      {shortDate(row.ran_at)} {shortTime(row.ran_at)}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 pr-3">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {row.source}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 pr-3 whitespace-nowrap">
                    +{row.ingest_episodes_new}
                    {iFail && <span className="text-red-600 ml-1">{row.ingest_failures} err</span>}
                  </TableCell>
                  <TableCell className="py-2 pr-3 whitespace-nowrap">
                    <span className="text-emerald-700">{row.transcribe_succeeded}✓</span>{" "}
                    <span className={tFail ? "text-red-600" : "text-ink-faint"}>
                      {row.transcribe_failed}✗
                    </span>
                  </TableCell>
                  <TableCell className="py-2 pr-3 whitespace-nowrap">
                    {row.classify_processed} proc
                    <span className="text-ink-faint"> · {row.classify_mentions} ment.</span>
                    {cFail && <span className="text-red-600 ml-1">{row.classify_failures} err</span>}
                  </TableCell>
                  <TableCell className="py-2 pr-3 whitespace-nowrap">
                    <span className="text-emerald-700">{row.score_succeeded}✓</span>{" "}
                    <span className={sFail ? "text-red-600" : "text-ink-faint"}>
                      {row.score_failed}✗
                    </span>
                  </TableCell>
                  <TableCell className="py-2 pr-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[rs]}`}
                    >
                      {STATUS_WORD[rs]}
                    </span>
                    {row.error_message && (
                      <div className="text-red-600 text-[10px] mt-1 max-w-xs truncate" title={row.error_message}>
                        {row.error_message}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
