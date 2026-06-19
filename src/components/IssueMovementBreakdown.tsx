import type { IssueMovementBreakdown as Breakdown, ShowContribution } from "@/lib/aggregate";
import { formatLean, leanColor, leanChipStyle } from "@/lib/lean";
import { Card } from "@/components/ui/card";

/** Compact audience figure: 14.5M, 314K. Reach is the weighting input, surfaced
 *  so the log-vs-linear question is visible (a huge audience, a peer-level bar). */
function compactReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

/** A canonical show's editorial lean - shown SEPARATELY from the bar color, since
 *  a show's usual politics and its stance on one issue can diverge. */
function EditorialBadge({ lean }: { lean: "L" | "M" | "R" }) {
  const s = leanChipStyle(lean);
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${s.cls}`}>
      {s.text}
    </span>
  );
}

function ShowRow({ show, maxAbs }: { show: ShowContribution; maxAbs: number }) {
  const widthPct = (Math.abs(show.contribution) / maxAbs) * 100;
  const isR = show.contribution > 0;
  const isL = show.contribution < 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.5fr_minmax(0,1fr)] items-center gap-3 py-1.5">
      {/* Who: show name + editorial-lean badge (NOT the bar color). */}
      <div className="flex items-center gap-2 min-w-0 justify-end text-right">
        <span className="text-sm font-medium text-foreground truncate">{show.show}</span>
        <EditorialBadge lean={show.editorialLean} />
      </div>

      {/* Bar: diverging from a center zero axis. Blue = pulled L, red = pulled R. */}
      <div className="relative h-6">
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
      </div>

      {/* Stance on THIS issue + how loud (mentions) + how big (reach). */}
      <div className="flex items-baseline gap-2 text-xs min-w-0">
        <span className={`font-semibold tabular-nums min-w-[2.75rem] ${leanColor(show.lean)}`}>
          {formatLean(show.lean)}
        </span>
        <span className="text-muted-foreground tabular-nums whitespace-nowrap">
          {show.mentions}&times; &middot; {compactReach(show.reach)}
        </span>
      </div>
    </div>
  );
}

function WhyQuote({ show }: { show: ShowContribution }) {
  if (!show.topQuote) return null;
  const dirColor = show.contribution >= 0 ? "text-red-700" : "text-blue-700";
  return (
    <div className="text-xs leading-relaxed">
      <span className={`font-semibold ${dirColor}`}>{show.show}</span>
      <span className="text-ink-faint"> &middot; {formatLean(show.lean)}</span>
      <p className="text-ink-body mt-1 italic">&ldquo;{show.topQuote.text}&rdquo;</p>
      <a
        href={show.topQuote.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground underline hover:text-ink-body not-italic"
      >
        {show.topQuote.episodeTitle} &rarr;
      </a>
    </div>
  );
}

interface Props {
  data: Breakdown;
  /** Max canonical shows to chart (rest folded into the count). */
  maxShows?: number;
  /** Heading style: "full" for a page section, "compact" inline under a mover. */
  variant?: "full" | "compact";
}

/**
 * "Who is moving this issue" - the per-show fractal of <IssueContributionsChart>.
 * Each canonical show is a diverging, reach-weighted contribution bar; the shares
 * sum to the issue's lean. Reuses the site's signature red(R)/blue(L) bar language
 * rather than a Recharts bar, so it reads as a sibling of the Index contribution
 * chart, not a different chart style.
 */
export function IssueMovementBreakdown({ data, maxShows = 12, variant = "full" }: Props) {
  if (data.shows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Not enough scored mentions in the last {data.windowDays} days to break this down yet.
      </p>
    );
  }

  const shown = data.shows.slice(0, maxShows);
  const maxAbs = Math.max(...shown.map((s) => Math.abs(s.contribution)), 0.1);
  const hidden = data.shows.length - shown.length;

  // Two "why" receipts: the strongest puller on each side that has a quote, so
  // the callout is balanced rather than one-sided.
  const topR = data.shows.find((s) => s.contribution > 0 && s.topQuote);
  const topL = data.shows.find((s) => s.contribution < 0 && s.topQuote);
  const receipts = [topR, topL].filter(Boolean) as ShowContribution[];

  return (
    <div>
      {variant === "full" && (
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Who&apos;s driving this issue this week
        </div>
      )}
      <div className={variant === "full" ? "text-lg font-semibold leading-tight" : "text-sm font-medium"}>
        {data.name} is{" "}
        <span className={`tabular-nums ${leanColor(data.issueLean)}`}>
          {formatLean(data.issueLean)}
        </span>{" "}
        over the last {data.windowDays} days, weighted by audience reach.
      </div>

      <Card className="mt-4 p-4">
        <div className="[&>div:not(:last-child)]:border-b [&>div]:border-border/60">
          {shown.map((s) => (
            <ShowRow key={s.show} show={s} maxAbs={maxAbs} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_2.5fr_minmax(0,1fr)] gap-3 text-[10px] uppercase tracking-wider text-ink-faint">
          <div className="text-right">{data.mentions.toLocaleString()} mentions</div>
          <div className="flex justify-between">
            <span>&larr; Pulls L</span>
            <span>Pulls R &rarr;</span>
          </div>
          <div />
        </div>
      </Card>

      {receipts.length > 0 && (
        <div className="mt-4 space-y-3 border-l-2 border-border pl-4">
          {receipts.map((s) => (
            <WhyQuote key={s.show} show={s} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
        Each bar is a show&apos;s <strong className="font-semibold text-ink-body">reach-weighted
        pull</strong> on this issue this week - longer means a bigger push, the side shows which way.
        <strong className="font-semibold text-ink-body"> Bar color is the show&apos;s stance on this
        issue</strong>; the <span className="font-semibold">L/M/R</span> badge is the show&apos;s
        usual politics. They can disagree - a left show can post a red bar (e.g. attacking pharma
        reads MAHA-coded right).{" "}
        {hidden > 0 && <>Plus {hidden} more {hidden === 1 ? "show" : "shows"}. </>}
        <a href="/methodology" className="underline hover:text-ink-body">How reach weighting works &rarr;</a>
      </p>
    </div>
  );
}
