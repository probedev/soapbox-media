"use client";

/**
 * EpisodeMentions - the expandable "receipts" panel under an activity-log row.
 *
 * Lazy-loads one episode's classified-and-scored issue mentions on expand
 * (GET /api/episodes/[id]/mentions) so the /log table never eager-loads the
 * full classifications join. Each mention shows the issue, its sentiment chip
 * (L+/R+, the same convention as the home Index), an intensity meter, and the
 * exact supporting quote the model flagged - the transparency payoff the page
 * promises ("receipts, in the open"), and the operator's lens for spotting
 * mis-scores before scaling channels.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import type { EpisodeMention, EpisodeMentionsResponse } from "@/lib/episodes";

/** Sentiment as an L+/R+ chip, matching the site-wide lean convention
 *  (negative = Left/blue, positive = Right/red). */
function sentimentChip(sentiment: number | null): { text: string; cls: string } {
  if (sentiment == null) return { text: "unscored", cls: "bg-muted text-muted-foreground" };
  if (sentiment > 0) return { text: `R+${sentiment.toFixed(1)}`, cls: "bg-red-100 text-red-800" };
  if (sentiment < 0) return { text: `L+${Math.abs(sentiment).toFixed(1)}`, cls: "bg-blue-100 text-blue-800" };
  return { text: "0.0", cls: "bg-muted text-ink-muted" };
}

function IntensityMeter({ intensity }: { intensity: number | null }) {
  const n = intensity ?? 0;
  return (
    <span className="inline-flex items-center gap-0.5" title={`Intensity ${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn("h-1.5 w-1.5 rounded-full", i <= n ? "bg-ink-body" : "bg-border")}
        />
      ))}
    </span>
  );
}

export function EpisodeMentions({ episodeId }: { episodeId: string }) {
  const [state, setState] = React.useState<{
    status: "loading" | "error" | "done";
    data?: EpisodeMentionsResponse;
  }>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/episodes/${episodeId}/mentions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: EpisodeMentionsResponse) => {
        if (!cancelled) setState({ status: "done", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  if (state.status === "loading") {
    return <div className="px-4 py-3 text-xs text-ink-faint">Loading classifications…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="px-4 py-3 text-xs text-red-600">
        Couldn&apos;t load this episode&apos;s classifications.
      </div>
    );
  }

  const { mentions, netLean, numIssues } = state.data!;
  if (mentions.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">
        No taxonomy issues detected - this episode was off-topic for the issue set.
      </div>
    );
  }

  const net = sentimentChip(netLean);
  return (
    <div className="px-4 py-3 bg-subtle/70 border-t border-muted">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5">
        What we classified &amp; scored ·{" "}
        <span className="tabular-nums">{mentions.length}</span> mention
        {mentions.length === 1 ? "" : "s"} across{" "}
        <span className="tabular-nums">{numIssues}</span> issue{numIssues === 1 ? "" : "s"}
        {netLean != null && (
          <>
            {" "}
            · episode net{" "}
            <span className={cn("inline-flex items-center rounded px-1 py-0.5 font-semibold", net.cls)}>
              {net.text}
            </span>
          </>
        )}
      </div>

      <div className="space-y-2">
        {mentions.map((m, i) => {
          const chip = sentimentChip(m.sentiment);
          return (
            <div
              key={i}
              className="grid grid-cols-[minmax(0,9rem)_3.5rem_auto_minmax(0,1fr)] items-start gap-3 text-xs"
            >
              <a
                href={`/issues/${m.issueSlug}`}
                title={m.issueName}
                className="font-medium text-ink-strong hover:underline truncate"
              >
                {m.issueName}
              </a>
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded px-1.5 py-0.5 font-semibold tabular-nums",
                  chip.cls,
                )}
              >
                {chip.text}
              </span>
              <IntensityMeter intensity={m.intensity} />
              <span className="text-ink-muted leading-snug">
                <span className="text-ink-faint">&ldquo;</span>
                {m.quote}
                <span className="text-ink-faint">&rdquo;</span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-ink-faint mt-3">
        Sentiment is −5 (left) … +5 (right) for that issue; intensity is the model&apos;s 1–5
        conviction. Quotes are excerpts, never full transcripts.
      </p>
    </div>
  );
}
