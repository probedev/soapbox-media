import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { IssueMovementBreakdown } from "@/components/IssueMovementBreakdown";
import type { IssueMovementBreakdown as Breakdown } from "@/lib/aggregate";
import { formatLean, leanColor } from "@/lib/lean";

interface Mover {
  slug: string;
  name: string;
  /** Change in lean week-over-week. Positive = moved right. */
  delta: number;
  /** Last week's lean, -10..+10 */
  fromLean: number;
  /** This week's lean, -10..+10 */
  toLean: number;
  /** Raw mention count in the current window. */
  currentMentions: number;
  /** Raw mention count in the prior (parallel) window. */
  prevMentions: number;
  /** currentMentions / prevMentions - >1 = attention rising, <1 = falling. */
  volumeRatio: number;
}

interface BiggestMoversProps {
  movers: Mover[];
  /** Per-mover "who's driving it" breakdowns, keyed by issue slug. Each row
   *  expands to its breakdown; a slug missing here just shows a link-out. */
  breakdowns?: Record<string, Breakdown>;
}

/**
 * Volume ratio reads naturally as "↑ 2.3×" when rising and "↓ 0.6×" when
 * falling - the arrow tells direction; the number is always the raw ratio
 * (60% of last week = "↓ 0.6×", not "1.7× lower"). A row with a sub-threshold
 * ratio (it earned its spot on the lean axis instead) gets a neutral dot.
 */
function formatVolumeRatio(r: number): string {
  if (!isFinite(r)) return "·";
  if (r >= 1.05) return `↑ ${r.toFixed(1)}×`;
  if (r <= 0.95) return `↓ ${r.toFixed(1)}×`;
  return "·";
}

function volumeColor(r: number): string {
  // Volume change is ideologically neutral - same gray either way. Slightly
  // dimmer when the ratio is unremarkable so the eye skips it.
  if (r >= 1.05 || r <= 0.95) return "text-ink-body";
  return "text-ink-faint";
}

export function BiggestMovers({ movers, breakdowns }: BiggestMoversProps) {
  // Mobile keeps three columns (Issue · This week · Change) so the row stays
  // readable on a 360px viewport; desktop expands to six, adding Last week,
  // Mentions, and Volume. A trailing chevron column toggles the breakdown.
  const cols =
    "grid grid-cols-[minmax(0,1fr)_4.5rem_5rem_1.25rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4rem_4.5rem_1.25rem] gap-x-3";

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Biggest movers this week</h2>
      <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
        {/* Column sub-headings */}
        <div className={`${cols} px-4 py-2`}>
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Issue</div>
          <div className="text-right text-[10px] uppercase tracking-wider text-ink-faint hidden sm:block">Last week</div>
          <div className="text-right text-[10px] uppercase tracking-wider text-ink-faint">This week</div>
          <div className="text-right text-[10px] uppercase tracking-wider text-ink-faint">Change</div>
          <div className="text-right text-[10px] uppercase tracking-wider text-ink-faint hidden sm:block">Mentions</div>
          <div className="text-right text-[10px] uppercase tracking-wider text-ink-faint hidden sm:block">Volume</div>
          <div />
        </div>

        {movers.map((m) => {
          const movedRight = m.delta > 0;
          const breakdown = breakdowns?.[m.slug];
          return (
            <Collapsible key={m.slug} className="group/mover">
              <CollapsibleTrigger
                className={`group ${cols} w-full items-center px-4 py-3 text-left hover:bg-subtle transition data-[state=open]:bg-subtle`}
              >
                <div className="font-medium text-foreground truncate">{m.name}</div>
                <div className={`text-right text-sm tabular-nums hidden sm:block ${leanColor(m.fromLean)}`}>
                  {formatLean(m.fromLean)}
                </div>
                <div className={`text-right text-sm tabular-nums font-semibold ${leanColor(m.toLean)}`}>
                  {formatLean(m.toLean)}
                </div>
                {/* Neutral arrow = direction of movement on the L<->R axis,
                    decoupled from where the issue currently sits. */}
                <div className="text-right text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                  {movedRight ? "→" : "←"} {Math.abs(m.delta).toFixed(1)}
                </div>
                <div className="text-right text-sm tabular-nums text-ink-muted hidden sm:block">
                  {m.currentMentions.toLocaleString()}
                </div>
                <div className={`text-right text-sm tabular-nums whitespace-nowrap hidden sm:block ${volumeColor(m.volumeRatio)}`}>
                  {formatVolumeRatio(m.volumeRatio)}
                </div>
                <svg
                  className="justify-self-end h-4 w-4 text-ink-faint transition-transform group-data-[state=open]:rotate-180"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-4 pb-5 pt-1 bg-subtle/40">
                {breakdown ? (
                  <IssueMovementBreakdown data={breakdown} variant="compact" />
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Not enough scored mentions this week to break this issue down.
                  </p>
                )}
                <a
                  href={`/issues/${m.slug}`}
                  className="inline-block mt-4 text-xs underline text-muted-foreground hover:text-ink-body"
                >
                  Open the {m.name} issue page &rarr;
                </a>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
        Issues earn a row for the biggest shifts this week on either axis: lean
        movement on the left–right scale (→ / ←) or a swing in attention
        (↑ / ↓ mention volume). An issue can move{" "}
        <span className="text-red-600">right</span> (→) yet still sit in{" "}
        <span className="text-blue-600">left</span> territory, or hold steady on
        lean while attention spikes or collapses.{" "}
        <span className="text-ink-body">Expand any row to see which shows drove it.</span>
      </p>
    </div>
  );
}
