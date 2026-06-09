/**
 * IssueActivityByTopic - "what alt-media is talking about" summary for /issues.
 *
 * The /issues page is otherwise a static taxonomy reference; this card adds the
 * one dimension it lacks - attention. It rolls the per-issue volume from the
 * home dashboard snapshot up into the same topics the list below is grouped by,
 * so the reader sees which areas are hot right now before scrolling the full
 * catalog. Distinct from the home page's "Biggest movers" (a lean-swing
 * leaderboard): this is an attention-volume distribution.
 *
 * Bars + the headline count use raw mention count (the intuitive "how much is
 * this discussed" metric). The lean tint uses volume-weighted lean (reach-
 * weighted, same basis as the Soapbox Index) so the direction is honest.
 *
 * Pure presentational - the page computes the rollup and passes it in, so this
 * adds no DB query (mirrors PanelBalance / PanelScale).
 */
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export interface TopicActivityRow {
  /** Topic slug for the /topics/[slug] link, or null for the unbucketed group. */
  slug: string | null;
  name: string;
  /** Raw classification count across this topic's issues in the window. */
  mentions: number;
  /** How many active issues rolled into this topic. */
  numIssues: number;
  /** Volume-weighted lean, -10..+10 (negative = left, positive = right). */
  lean: number;
}

interface IssueActivityByTopicProps {
  rows: TopicActivityRow[];
  totalMentions: number;
  windowDays: number;
}

/** "L+3.0" / "R+1.2" / "0.0", colored by side. Mirrors the home Index convention. */
function leanLabel(lean: number): { text: string; className: string } {
  const mag = Math.abs(lean).toFixed(1);
  if (lean <= -0.05) return { text: `L+${mag}`, className: "text-blue-700" };
  if (lean >= 0.05) return { text: `R+${mag}`, className: "text-red-700" };
  return { text: "0.0", className: "text-muted-foreground" };
}

function barColor(lean: number): string {
  if (lean <= -0.05) return "bg-blue-500";
  if (lean >= 0.05) return "bg-red-500";
  return "bg-ink-faint";
}

export function IssueActivityByTopic({
  rows,
  totalMentions,
  windowDays,
}: IssueActivityByTopicProps) {
  if (rows.length === 0) return null;
  const maxMentions = Math.max(...rows.map((r) => r.mentions), 1);

  return (
    <div className="border border-border bg-card rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          What&apos;s being talked about
        </div>
        <div className="text-xs text-ink-faint">last {windowDays} days</div>
      </div>
      <div className="text-sm text-ink-muted mb-4">
        <span className="font-semibold tabular-nums text-foreground">
          {totalMentions.toLocaleString()}
        </span>{" "}
        mentions across{" "}
        <span className="font-semibold tabular-nums text-foreground">{rows.length}</span>{" "}
        topics
      </div>

      <Table>
        <TableBody className="[&_tr:last-child]:border-0">
          {rows.map((r) => {
            const widthPct = (r.mentions / maxMentions) * 100;
            const lean = leanLabel(r.lean);
            const label = (
              <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
            );
            return (
              <TableRow
                key={r.slug ?? r.name}
                className="grid grid-cols-[minmax(0,1.4fr)_2fr_auto] items-center gap-3 mb-1.5 last:mb-0 border-0 hover:bg-transparent"
              >
                <TableCell className="p-0 truncate">
                  {r.slug ? (
                    <a href={`/topics/${r.slug}`} className="hover:text-ink-muted">
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </TableCell>

                {/* mention-volume bar */}
                <TableCell className="p-0 relative h-5 rounded bg-muted overflow-hidden">
                  <div
                    className={cn("absolute inset-y-0 left-0 rounded", barColor(r.lean))}
                    style={{ width: `${Math.max(widthPct, 2)}%` }}
                    title={`${r.mentions.toLocaleString()} mentions · ${r.numIssues} issue${r.numIssues === 1 ? "" : "s"}`}
                  />
                </TableCell>

                <TableCell className="p-0 flex items-baseline gap-2 text-xs justify-end">
                  <span className="tabular-nums text-ink-body min-w-[3rem] text-right">
                    {r.mentions.toLocaleString()}
                  </span>
                  <span className={cn("tabular-nums font-semibold min-w-[3rem]", lean.className)}>
                    {lean.text}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="text-[11px] text-ink-faint mt-4 leading-relaxed">
        Bar length is mention count over the last {windowDays} days; the tint and L/R figure
        show each topic&apos;s volume-weighted lean. The full taxonomy is below.
      </p>
    </div>
  );
}
