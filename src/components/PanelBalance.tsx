/**
 * PanelBalance — honest cohort badge for /channels.
 *
 * Two stacked horizontal bars (count, reach) make the asymmetry between
 * "how many shows on each side" and "how big each side's audience is"
 * visible at a glance. Counts are roughly balanced by editorial intent
 * but reach skews — that's a fact about the alt-media landscape (the
 * largest right-leaning shows are bigger than the largest left-leaning
 * ones), not a panel-curation bias, and the badge says so explicitly.
 *
 * Reach is unique-show (max across platform rows), same methodology as
 * SystemStats.audienceReach — one human who follows Ben Shapiro on YT
 * AND podcast is one audience unit, not two.
 */
import { cn } from "@/lib/utils";

interface ShowLike {
  political_lean: "L" | "M" | "R";
  maxReach: number;
  cohort: "independent" | "legacy";
}

interface PanelBalanceProps {
  shows: ShowLike[];
}

function compactReach(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

const LEAN_BG: Record<"L" | "M" | "R", string> = {
  L: "bg-blue-500",
  M: "bg-gray-400",
  R: "bg-red-500",
};

const COHORT_BG: Record<"independent" | "legacy", string> = {
  independent: "bg-emerald-600",
  legacy: "bg-amber-500",
};

interface Segment {
  key: string;
  value: number;
  label: string;
  colorClass: string;
}

function StackedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex w-full h-6 rounded overflow-hidden text-[11px] font-medium text-white">
      {segments.map((seg) => {
        const pct = (seg.value / total) * 100;
        return (
          <div
            key={seg.key}
            className={cn(
              "flex items-center justify-center min-w-0 px-1.5",
              seg.colorClass,
            )}
            style={{ flexBasis: `${pct}%` }}
            title={`${seg.label} (${pct.toFixed(0)}%)`}
          >
            <span className="truncate tabular-nums">{seg.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PanelBalance({ shows }: PanelBalanceProps) {
  const counts = { L: 0, M: 0, R: 0 };
  const reach = { L: 0, M: 0, R: 0 };
  const cohortCounts = { independent: 0, legacy: 0 };
  const cohortReach = { independent: 0, legacy: 0 };
  for (const s of shows) {
    counts[s.political_lean] += 1;
    reach[s.political_lean] += s.maxReach;
    cohortCounts[s.cohort] += 1;
    cohortReach[s.cohort] += s.maxReach;
  }
  // Only show the cohort split once legacy channels are actually in the panel.
  const hasCohortSplit = cohortCounts.legacy > 0 && cohortCounts.independent > 0;
  const totalShows = counts.L + counts.M + counts.R;
  const totalReach = reach.L + reach.M + reach.R;

  // Average reach per show in each cohort. Drives the asymmetry copy
  // dynamically so it stays correct as the panel grows / rebalances.
  const avg = {
    L: counts.L > 0 ? reach.L / counts.L : 0,
    M: counts.M > 0 ? reach.M / counts.M : 0,
    R: counts.R > 0 ? reach.R / counts.R : 0,
  };
  // Whichever lean has the biggest average reach is the side "punching above
  // its count weight"; whichever is smallest is "punching below."
  const sides: ("L" | "M" | "R")[] = ["L", "M", "R"];
  const biggest = sides.reduce((a, b) => (avg[b] > avg[a] ? b : a));
  const smallest = sides.reduce((a, b) => (avg[b] < avg[a] ? b : a));
  const sideLabel = (l: "L" | "M" | "R") =>
    l === "L" ? "left-leaning" : l === "R" ? "right-leaning" : "middle";

  const showSegments: Segment[] = sides.map((lean) => ({
    key: lean,
    value: counts[lean],
    label: `${lean} ${counts[lean]}`,
    colorClass: LEAN_BG[lean],
  }));
  const reachSegments: Segment[] = sides.map((lean) => ({
    key: lean,
    value: reach[lean],
    label: `${lean} ${compactReach(reach[lean])}`,
    colorClass: LEAN_BG[lean],
  }));

  const cohortLabel = { independent: "Independent", legacy: "Legacy" } as const;
  const cohortKeys = ["independent", "legacy"] as const;
  const cohortShowSegments: Segment[] = cohortKeys.map((c) => ({
    key: c,
    value: cohortCounts[c],
    label: `${cohortLabel[c]} ${cohortCounts[c]}`,
    colorClass: COHORT_BG[c],
  }));
  const cohortReachSegments: Segment[] = cohortKeys.map((c) => ({
    key: c,
    value: cohortReach[c],
    label: `${cohortLabel[c]} ${compactReach(cohortReach[c])}`,
    colorClass: COHORT_BG[c],
  }));

  // Only render the asymmetry sentence when the ratio is meaningfully off
  // (biggest avg ≥ 1.25× smallest). Otherwise the cohorts are close enough
  // that calling out a "punch above/below" reads as overstated.
  const ratio = avg[smallest] > 0 ? avg[biggest] / avg[smallest] : 0;
  const showAsymmetryNote = ratio >= 1.25 && biggest !== smallest;

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-5 mt-6">
      <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
          Panel balance
        </h2>
        <span className="text-[11px] text-gray-500">
          what we track · not what they say
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Shows
            </span>
            <span className="text-[11px] text-gray-500 tabular-nums">
              {totalShows} total
            </span>
          </div>
          <StackedBar segments={showSegments} />
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Combined audience reach
            </span>
            <span className="text-[11px] text-gray-500 tabular-nums">
              {compactReach(totalReach)} total
            </span>
          </div>
          <StackedBar segments={reachSegments} />
        </div>

        {hasCohortSplit && (
          <>
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Shows by cohort
                </span>
              </div>
              <StackedBar segments={cohortShowSegments} />
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Reach by cohort
                </span>
              </div>
              <StackedBar segments={cohortReachSegments} />
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-gray-600 mt-4 leading-relaxed">
        Show counts are intentionally balanced across the editorial spectrum.
        {showAsymmetryNote && (
          <>
            {" "}
            Reach is not — {sideLabel(biggest)} shows carry larger average
            audiences (
            <span className="tabular-nums">{compactReach(avg[biggest])}</span>{" "}
            avg vs{" "}
            <span className="tabular-nums">{compactReach(avg[smallest])}</span>{" "}
            for {sideLabel(smallest)}), so total reach skews {biggest}. The
            Soapbox Index weights every mention by{" "}
            <code className="text-[11px] bg-gray-100 px-1 rounded">log10(reach)</code>,
            which dampens this asymmetry but doesn&apos;t erase it — worth
            knowing when reading the Index number.
          </>
        )}
      </p>
    </div>
  );
}
