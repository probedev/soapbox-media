import type { UsageLogRow } from "@/lib/usage";

/**
 * Public pipeline-health view for /log. Renders two things from usage_log:
 *   1. a last-N-runs grid (stage × run, green/amber/red/idle) for at-a-glance
 *      issue spotting, and
 *   2. a detailed recent-runs table with per-stage counts.
 * Deliberately shows NO cost/token data — that stays on the operator-only
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
  idle: "bg-gray-200",
};

const STATUS_BADGE: Record<StageStatus, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  fail: "bg-red-100 text-red-800",
  idle: "bg-gray-100 text-gray-600",
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
      <div className="border border-gray-200 rounded-lg bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
          Pipeline health
        </h2>
        <p className="text-sm text-gray-500 mt-3">No pipeline runs recorded yet.</p>
      </div>
    );
  }

  // runs come most-recent-first. Grid reads oldest → newest, left → right.
  const gridRuns = [...runs].slice(0, 30).reverse();
  const latest = runs[0];
  const latestStatus = runStatus(latest);
  const tableRuns = runs.slice(0, 20);

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-6">
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
          Pipeline health
        </h2>
        <span className="text-[11px] text-gray-500 flex items-center gap-2">
          <span>Last run {relTime(latest.ran_at)}</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[latestStatus]}`}
          >
            {STATUS_WORD[latestStatus]}
          </span>
        </span>
      </div>

      {/* Stage × run health grid */}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {STAGES.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 mb-1.5">
              <div className="w-20 shrink-0 text-[11px] text-gray-500 text-right pr-1">
                {label}
              </div>
              <div className="flex gap-1">
                {gridRuns.map((row) => {
                  const s = stageStatus(row, key);
                  return (
                    <div
                      key={row.id}
                      className={`w-3.5 h-3.5 rounded-sm ${CELL_CLASS[s]}`}
                      title={`${shortDate(row.ran_at)} ${shortTime(row.ran_at)} — ${label}: ${STATUS_WORD[s]}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {/* axis labels */}
          <div className="flex items-center gap-2 mt-1">
            <div className="w-20 shrink-0" />
            <div className="flex justify-between w-full text-[10px] text-gray-400">
              <span>{gridRuns.length ? shortDate(gridRuns[0].ran_at) : ""}</span>
              <span>
                {gridRuns.length ? shortDate(gridRuns[gridRuns.length - 1].ran_at) : ""}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-[10px] text-gray-500">
        {(["ok", "warn", "fail", "idle"] as StageStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${CELL_CLASS[s]}`} />
            {STATUS_WORD[s]}
          </span>
        ))}
      </div>

      {/* Detailed recent-runs table */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 text-left border-b border-gray-200">
              <th className="font-medium py-2 pr-3">When</th>
              <th className="font-medium py-2 pr-3">Source</th>
              <th className="font-medium py-2 pr-3">Ingest</th>
              <th className="font-medium py-2 pr-3">Transcribe</th>
              <th className="font-medium py-2 pr-3">Classify</th>
              <th className="font-medium py-2 pr-3">Score</th>
              <th className="font-medium py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {tableRuns.map((row) => {
              const rs = runStatus(row);
              const tFail = (row.transcribe_failed || 0) > 0;
              const sFail = (row.score_failed || 0) > 0;
              const cFail = (row.classify_failures || 0) > 0;
              const iFail = (row.ingest_failures || 0) > 0;
              return (
                <tr key={row.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="text-gray-900">{relTime(row.ran_at)}</span>
                    <span className="text-gray-400 ml-1">
                      {shortDate(row.ran_at)} {shortTime(row.ran_at)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">
                      {row.source}
                    </span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    +{row.ingest_episodes_new}
                    {iFail && <span className="text-red-600 ml-1">{row.ingest_failures} err</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="text-emerald-700">{row.transcribe_succeeded}✓</span>{" "}
                    <span className={tFail ? "text-red-600" : "text-gray-400"}>
                      {row.transcribe_failed}✗
                    </span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {row.classify_processed} proc
                    <span className="text-gray-400"> · {row.classify_mentions} ment.</span>
                    {cFail && <span className="text-red-600 ml-1">{row.classify_failures} err</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="text-emerald-700">{row.score_succeeded}✓</span>{" "}
                    <span className={sFail ? "text-red-600" : "text-gray-400"}>
                      {row.score_failed}✗
                    </span>
                  </td>
                  <td className="py-2 pr-3">
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
