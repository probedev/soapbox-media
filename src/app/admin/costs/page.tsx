import { getUsageSummary, type UsageLogRow } from "@/lib/usage";
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
          warn ? "text-amber-600" : "text-gray-900"
        }`}
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-gray-500 mt-2 font-medium">
        {label}
      </div>
      {sublabel && (
        <div className="text-[11px] text-gray-400 mt-0.5">{sublabel}</div>
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

  return (
    <div className="px-4 py-3 grid grid-cols-[140px_1fr_70px_80px_70px] items-center gap-3 text-sm">
      <div className="text-gray-700 tabular-nums">{formatDate(run.ran_at)}</div>
      <div className="text-xs text-gray-600 font-mono truncate">
        {stagesSummary || <span className="text-gray-400">no work</span>}
      </div>
      <div className="text-xs text-gray-500 tabular-nums text-right">
        {formatDuration(run.duration_ms)}
      </div>
      <div
        className={`text-xs tabular-nums text-right ${
          failures > 0 ? "text-amber-700" : "text-gray-400"
        }`}
      >
        {failures > 0 ? `${failures} failed` : "—"}
      </div>
      <div className="text-sm tabular-nums text-right font-semibold text-gray-900">
        {formatUsd(Number(run.anthropic_cost_usd) || 0)}
      </div>
    </div>
  );
}

export default async function AdminCostsPage() {
  const u = await getUsageSummary();
  const monthlyBurnRatio = u.projectedMonthlyCost / MONTHLY_BUDGET;
  const overBudget = monthlyBurnRatio > 1;
  const nearBudget = monthlyBurnRatio > 0.75;

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-16 max-w-5xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">
            ← Soapbox Index
          </a>{" "}
          ·{" "}
          <span className="text-amber-600">Admin</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Costs
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-2xl">
          Anthropic token spend per pipeline run. Captured automatically each
          time the daily cron fires. PodScan, Vercel, and Supabase are flat
          monthly fees and not yet broken out here.
        </p>

        {/* Headline stats */}
        <div className="mt-10 border border-gray-200 rounded-lg bg-white p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <Stat
              value={formatUsd(u.todayCost)}
              label="Today"
              sublabel={`${u.dailySeries[u.dailySeries.length - 1]?.runs || 0} runs`}
            />
            <Stat value={formatUsd(u.last7dCost)} label="Last 7 days" />
            <Stat value={formatUsd(u.last30dCost)} label="Last 30 days" />
            <Stat
              value={formatUsd(u.projectedMonthlyCost)}
              label="Monthly run-rate"
              sublabel={`Budget: ${formatUsd(MONTHLY_BUDGET)} (${(monthlyBurnRatio * 100).toFixed(0)}%)`}
              warn={overBudget || nearBudget}
            />
          </div>
        </div>

        {/* Budget bar */}
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1.5">
            Monthly burn vs ${MONTHLY_BUDGET.toLocaleString()} budget
          </div>
          <div className="relative h-2 rounded-full bg-gray-100 overflow-hidden">
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

        {/* Daily chart */}
        <div className="mt-12">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Daily cost (last 30 days)</h2>
            <span className="text-xs text-gray-500">
              {u.totalRuns.toLocaleString()} runs total in log
            </span>
          </div>
          {u.dailySeries.every((d) => d.cost === 0) ? (
            <div className="text-sm text-gray-500 italic border border-gray-200 rounded-lg p-6 bg-white">
              No usage data yet. Once the cron runs (or you trigger a manual
              run), bars will populate here.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg bg-white p-4">
              <DailyCostChart series={u.dailySeries} />
            </div>
          )}
        </div>

        {/* Recent runs */}
        <div className="mt-12">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent runs</h2>
            <span className="text-xs text-gray-500">
              showing {u.recentRuns.length} of {u.totalRuns.toLocaleString()}
            </span>
          </div>
          {u.recentRuns.length === 0 ? (
            <div className="text-sm text-gray-500 italic border border-gray-200 rounded-lg p-6 bg-white">
              No runs recorded yet.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
              <div className="px-4 py-2 grid grid-cols-[140px_1fr_70px_80px_70px] gap-3 text-[10px] uppercase tracking-wider text-gray-400 bg-gray-50">
                <div>Started</div>
                <div>Stages</div>
                <div className="text-right">Duration</div>
                <div className="text-right">Failures</div>
                <div className="text-right">Cost</div>
              </div>
              {u.recentRuns.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
