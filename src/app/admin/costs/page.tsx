import { getUsageSummary, type UsageLogRow } from "@/lib/usage";
import { getActualCost, isBillingReconcileConfigured } from "@/lib/anthropic-billing";
import { Card } from "@/components/ui/card";
import { AdminNav } from "@/components/AdminNav";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";

const MONTHLY_BUDGET = 1000;

function formatUsd(n: number): string {
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

interface StatProps {
  value: string;
  label: string;
  sublabel?: string;
  warn?: boolean;
}

function Stat({ value, label, sublabel, warn }: StatProps) {
  return (
    <div>
      <div
        className={`text-3xl md:text-4xl font-semibold tracking-tight tabular-nums ${
          warn ? "text-amber-600" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mt-2 font-medium">
        {label}
      </div>
      {sublabel && (
        <div className="text-[11px] text-ink-faint mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}

function DailyCostChart({
  series,
}: {
  series: { date: string; cost: number; runs: number }[];
}) {
  const width = 880;
  const height = 140;
  const padX = 12;
  const padY = 12;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const maxCost = Math.max(...series.map((s) => s.cost), 0.01);
  const barW = plotW / series.length;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Daily Anthropic cost, last 30 days"
    >
      {/* y-axis labels */}
      <text x={padX} y={padY + 4} fontSize="10" fill="#9ca3af">
        ${maxCost.toFixed(2)}
      </text>
      <text x={padX} y={padY + plotH + 2} fontSize="10" fill="#9ca3af">
        $0
      </text>
      {/* bars */}
      {series.map((d, i) => {
        const barH = (d.cost / maxCost) * plotH;
        const x = padX + i * barW;
        const y = padY + plotH - barH;
        return (
          <g key={d.date}>
            <rect
              x={x + 1}
              y={y}
              width={barW - 2}
              height={Math.max(barH, 1)}
              fill={d.cost > 0 ? "#3b82f6" : "#e5e7eb"}
              rx={1}
            >
              <title>
                {d.date}: {formatUsd(d.cost)} ({d.runs} runs)
              </title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

function RunRow({ run }: { run: UsageLogRow }) {
  const stagesSummary = [
    run.ingest_episodes_new > 0 && `ingest+${run.ingest_episodes_new}`,
    run.transcribe_succeeded > 0 && `tx+${run.transcribe_succeeded}`,
    run.classify_mentions > 0 && `mentions+${run.classify_mentions}`,
    run.score_succeeded > 0 && `scored+${run.score_succeeded}`,
  ]
    .filter(Boolean)
    .join("  ");

  const failures =
    run.ingest_failures +
    run.transcribe_failed +
    run.classify_failures +
    run.score_failed;

  const isCron = (run.source ?? "cron") === "cron";
  const label =
    !isCron && run.raw_summary && typeof run.raw_summary === "object"
      ? (run.raw_summary as { label?: string }).label
      : null;

  return (
    <div className="px-4 py-3 grid grid-cols-[140px_1fr_70px_80px_70px] items-center gap-3 text-sm">
      <div className="text-ink-body tabular-nums">{formatDate(run.ran_at)}</div>
      <div className="text-xs text-ink-muted font-mono truncate flex items-center gap-2">
        {!isCron && (
          <span className="shrink-0 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {run.source}
          </span>
        )}
        <span className="truncate">
          {label || stagesSummary || <span className="text-ink-faint">no work</span>}
        </span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums text-right">
        {formatDuration(run.duration_ms)}
      </div>
      <div
        className={`text-xs tabular-nums text-right ${
          failures > 0 ? "text-amber-700" : "text-ink-faint"
        }`}
      >
        {failures > 0 ? `${failures} failed` : "-"}
      </div>
      <div className="text-sm tabular-nums text-right font-semibold text-foreground">
        {formatUsd(Number(run.anthropic_cost_usd) || 0)}
      </div>
    </div>
  );
}

export default async function AdminCostsPage() {
  const u = await getUsageSummary();
  const actual = await getActualCost(30);
  const reconcileConfigured = isBillingReconcileConfigured();
  // Budget gauge tracks the RECURRING (cron) run-rate - one-off backfills are
  // shown separately so a single big run doesn't trip the budget alarm.
  const monthlyBurnRatio = u.recurringMonthlyCost / MONTHLY_BUDGET;
  const overBudget = monthlyBurnRatio > 1;
  const nearBudget = monthlyBurnRatio > 0.75;
  const estimate30d = u.last30dCost;
  const actual30d = actual?.totalUsd ?? null;
  const reconcileDelta = actual30d !== null ? actual30d - estimate30d : null;
  const reconcilePct =
    actual30d !== null && estimate30d > 0 ? (estimate30d / actual30d) * 100 : null;

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <AdminNav active="costs" />
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Costs
        </h1>
        <p className="text-ink-muted mt-3 leading-relaxed max-w-2xl">
          Anthropic token spend per run, estimated from response token counts.
          Captured automatically on every cron run <em>and</em> manual CLI run
          (classify, score, backfills). The budget gauge tracks the recurring
          (cron) run-rate; one-off backfills are shown separately. PodScan,
          Vercel, and Supabase are flat monthly fees, not broken out here.
        </p>

        {/* Headline stats */}
        <Card className="mt-10 p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <Stat
              value={formatUsd(u.todayCost)}
              label="Today"
              sublabel={`${u.dailySeries[u.dailySeries.length - 1]?.runs || 0} runs`}
            />
            <Stat value={formatUsd(u.last7dCost)} label="Last 7 days" />
            <Stat value={formatUsd(u.last30dCost)} label="Last 30 days" />
            <Stat
              value={formatUsd(u.recurringMonthlyCost)}
              label="Recurring run-rate"
              sublabel={`Budget: ${formatUsd(MONTHLY_BUDGET)} (${(monthlyBurnRatio * 100).toFixed(0)}%)`}
              warn={overBudget || nearBudget}
            />
          </div>
        </Card>

        {/* Budget bar */}
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Recurring (cron) burn vs ${MONTHLY_BUDGET.toLocaleString()} budget
          </div>
          <div className="relative h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${
                overBudget
                  ? "bg-red-500"
                  : nearBudget
                  ? "bg-amber-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${Math.min(100, monthlyBurnRatio * 100)}%` }}
            />
          </div>
        </div>

        {/* One-off spend + estimate-vs-actual reconciliation */}
        <Card className="mt-3 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                One-off / manual (30d)
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {formatUsd(u.oneOffLast30dCost)}
              </div>
              <div className="text-[11px] text-ink-faint mt-0.5">
                Backfills + manual CLI drains, excluded from the run-rate above.
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Estimated (30d)
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {formatUsd(estimate30d)}
              </div>
              <div className="text-[11px] text-ink-faint mt-0.5">
                Our token-count estimate (all sources).
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Actual billed (30d)
              </div>
              {actual30d !== null ? (
                <>
                  <div className="text-2xl font-semibold tabular-nums mt-1">
                    {formatUsd(actual30d)}
                  </div>
                  <div className="text-[11px] text-ink-faint mt-0.5">
                    Estimate is {reconcilePct !== null ? `${reconcilePct.toFixed(0)}%` : "-"} of actual
                    {reconcileDelta !== null && (
                      <>
                        {" "}
                        ({reconcileDelta >= 0 ? "under" : "over"} by{" "}
                        {formatUsd(Math.abs(reconcileDelta))})
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-semibold tabular-nums mt-1 text-ink-faint">-</div>
                  <div className="text-[11px] text-ink-faint mt-0.5">
                    {reconcileConfigured
                      ? "Anthropic Admin API unavailable (see server logs)."
                      : "Set ANTHROPIC_ADMIN_KEY (sk-ant-admin...) to reconcile against Anthropic billing."}
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>

        {/* Daily chart */}
        <div className="mt-12">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Daily cost (last 30 days)</h2>
            <span className="text-xs text-muted-foreground">
              {u.totalRuns.toLocaleString()} runs total in log
            </span>
          </div>
          {u.dailySeries.every((d) => d.cost === 0) ? (
            <Card className="text-sm text-muted-foreground italic p-6">
              No usage data yet. Once the cron runs (or you trigger a manual
              run), bars will populate here.
            </Card>
          ) : (
            <Card className="p-4">
              <DailyCostChart series={u.dailySeries} />
            </Card>
          )}
        </div>

        {/* Recent runs */}
        <div className="mt-12">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent runs</h2>
            <span className="text-xs text-muted-foreground">
              showing {u.recentRuns.length} of {u.totalRuns.toLocaleString()}
            </span>
          </div>
          {u.recentRuns.length === 0 ? (
            <Card className="text-sm text-muted-foreground italic p-6">
              No runs recorded yet.
            </Card>
          ) : (
            <Card className="divide-y divide-border">
              <div className="px-4 py-2 grid grid-cols-[140px_1fr_70px_80px_70px] gap-3 text-[10px] uppercase tracking-wider text-ink-faint bg-subtle">
                <div>Started</div>
                <div>Stages</div>
                <div className="text-right">Duration</div>
                <div className="text-right">Failures</div>
                <div className="text-right">Cost</div>
              </div>
              {u.recentRuns.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </Card>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
