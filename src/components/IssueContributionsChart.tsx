import {
  getIndexBreakdown,
  type IndexBreakdown,
  type IssueContribution,
} from "@/lib/aggregate";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";

function formatLean(direction: "L" | "R" | "neutral", magnitude: number): string {
  if (direction === "neutral") return "0.0";
  return `${direction}+${magnitude.toFixed(1)}`;
}

function leanColor(direction: "L" | "R" | "neutral"): string {
  if (direction === "L") return "text-blue-600";
  if (direction === "R") return "text-red-600";
  return "text-ink-muted";
}

function ContributionRow({
  issue,
  maxAbsContribution,
}: {
  issue: IssueContribution;
  maxAbsContribution: number;
}) {
  const widthPct = (Math.abs(issue.contribution) / maxAbsContribution) * 100;
  const isR = issue.contribution > 0;
  const isL = issue.contribution < 0;
  const direction = isR ? "R" : isL ? "L" : "neutral";
  const sentimentLabel = formatLean(direction, Math.abs(issue.avgSentiment));

  return (
    <TableRow className="group relative grid grid-cols-[1fr_2.5fr_140px] items-center gap-4 py-1.5 hover:bg-subtle px-2 -mx-2 rounded transition border-0">
      <TableCell className="p-0 text-sm font-medium text-foreground text-right truncate">
        {/* Stretched link makes the whole row navigable while keeping one href. */}
        <a
          href={`/issues/${issue.slug}`}
          className="before:absolute before:inset-0 before:content-['']"
        >
          {issue.name}
        </a>
      </TableCell>

      {/* Centered horizontal bar with zero axis */}
      <TableCell className="p-0 relative h-6">
        <div className="absolute inset-y-0 left-1/2 w-px bg-input" aria-hidden />
        {isL && (
          <div
            className="absolute top-0.5 bottom-0.5 bg-blue-500 rounded-l"
            style={{ right: "50%", width: `${widthPct / 2}%` }}
          />
        )}
        {isR && (
          <div
            className="absolute top-0.5 bottom-0.5 bg-red-500 rounded-r"
            style={{ left: "50%", width: `${widthPct / 2}%` }}
          />
        )}
      </TableCell>

      <TableCell className="p-0 flex items-baseline gap-2 text-xs">
        <span className={`font-semibold tabular-nums ${leanColor(direction)} min-w-[2.75rem]`}>
          {sentimentLabel}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {issue.numClassifications} mentions
        </span>
      </TableCell>
    </TableRow>
  );
}

interface IssueContributionsChartProps {
  windowDays?: number;
  /** Precomputed breakdown (from the home snapshot). When provided the
   *  component skips its own DB aggregation; otherwise it computes live. */
  breakdown?: IndexBreakdown;
}

export async function IssueContributionsChart({
  windowDays = 30,
  breakdown,
}: IssueContributionsChartProps) {
  const data = breakdown ?? (await getIndexBreakdown(windowDays));

  if (data.issues.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No classifications in the last {windowDays} days. Run the classify + score pipeline to
        populate this chart.
      </div>
    );
  }

  const maxAbs = Math.max(...data.issues.map((i) => Math.abs(i.contribution)), 1);

  // Auto-generated narrative - pick top 3 L pullers and top 3 R pullers
  const lPullers = data.issues.filter((i) => i.direction === "L").slice(0, 3);
  const rPullers = data.issues.filter((i) => i.direction === "R").slice(0, 3);
  const indexLabel = data.index >= 0 ? `R+${data.index.toFixed(1)}` : `L+${Math.abs(data.index).toFixed(1)}`;
  const indexColor = data.index >= 0 ? "text-red-600" : "text-blue-600";

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Why is the Index where it is?
      </div>
      <div className="text-2xl font-semibold leading-tight">
        The Soapbox Index is{" "}
        <span className={`tabular-nums ${indexColor}`}>{indexLabel}</span> over the last{" "}
        {windowDays} days.
      </div>
      <p className="text-ink-body mt-3 leading-relaxed">
        {lPullers.length > 0 && (
          <>
            <span className="font-medium">Pulling left</span>:{" "}
            {lPullers.map((i, idx) => (
              <span key={i.slug}>
                {idx > 0 && (idx === lPullers.length - 1 ? ", and " : ", ")}
                <span className="text-blue-700 font-medium">{i.name}</span>
              </span>
            ))}
            .{" "}
          </>
        )}
        {rPullers.length > 0 && (
          <>
            <span className="font-medium">Pulling right</span>:{" "}
            {rPullers.map((i, idx) => (
              <span key={i.slug}>
                {idx > 0 && (idx === rPullers.length - 1 ? ", and " : ", ")}
                <span className="text-red-700 font-medium">{i.name}</span>
              </span>
            ))}
            .
          </>
        )}
      </p>

      <Card className="mt-6 p-4">
        <Table>
          <TableBody className="[&_tr:last-child]:border-0">
            {data.issues.map((issue) => (
              <ContributionRow
                key={issue.slug}
                issue={issue}
                maxAbsContribution={maxAbs}
              />
            ))}
          </TableBody>
        </Table>
        <div className="mt-4 grid grid-cols-[1fr_2.5fr_140px] gap-4 text-[10px] uppercase tracking-wider text-ink-faint">
          <div className="text-right">{data.totalClassifications.toLocaleString()} mentions</div>
          <div className="flex justify-between">
            <span>← Pulls L</span>
            <span>Pulls R →</span>
          </div>
          <div />
        </div>
      </Card>

      <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
        Each bar shows <strong className="font-semibold text-ink-body">how much that issue moved
        the Soapbox Index</strong> over the last {windowDays} days - longer means a bigger push,
        and the side shows which way it pushed. The number is the issue&apos;s{" "}
        <strong className="font-semibold text-ink-body">average lean</strong> - which way it tilts
        per mention. The two can disagree: an issue discussed a lot but mildly can move the Index
        more than one discussed rarely but intensely.{" "}
        <a href="/methodology" className="underline hover:text-ink-body">How this is calculated →</a>{" "}
        Click any issue for the channel-level breakdown.
      </p>
    </div>
  );
}
