"use client";

/**
 * ChannelIssueBreakdown - the per-issue list on a channel page. Each row shows
 * the channel's lean on that issue (the slider + L+/R+ figure); clicking a row
 * expands it to reveal the exact scored mentions for THIS channel on THAT issue
 * - the same supporting-quote + sentiment + intensity receipts we already show
 * per episode (see EpisodeMentions), lazy-loaded from
 * /api/channels/[id]/issues/[slug]/mentions. Replaces the old behavior of
 * linking out to the system-wide issue page; that page is still reachable via a
 * link inside the expanded panel.
 */
import * as React from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDateET } from "@/lib/utils";
import { formatLean, leanColor } from "@/lib/lean";
import { SentimentChip, IntensityMeter } from "@/components/Lean";
import type { IssueOnChannel } from "@/lib/aggregate";
import type { ChannelIssueMentionsResponse } from "@/app/api/channels/[id]/issues/[slug]/mentions/route";

function formatDate(iso: string): string {
  return formatDateET(iso, { month: "short", day: "numeric", year: "numeric" });
}

/** Lazy-loaded receipts panel for one channel + one issue. */
function IssueMentionsPanel({
  channelId,
  issueSlug,
  issueName,
}: {
  channelId: string;
  issueSlug: string;
  issueName: string;
}) {
  const [state, setState] = React.useState<{
    status: "loading" | "error" | "done";
    data?: ChannelIssueMentionsResponse;
  }>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/channels/${channelId}/issues/${issueSlug}/mentions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: ChannelIssueMentionsResponse) => {
        if (!cancelled) setState({ status: "done", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, issueSlug]);

  if (state.status === "loading") {
    return <div className="px-4 py-3 text-xs text-ink-faint">Loading mentions…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="px-4 py-3 text-xs text-red-600">
        Couldn&apos;t load this channel&apos;s mentions for this issue.
      </div>
    );
  }

  const { mentions } = state.data!;
  if (mentions.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">
        No scored mentions for this issue in the last 30 days.
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-subtle/70 border-t border-muted">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2.5">
        What we classified &amp; scored on {issueName} ·{" "}
        <span className="tabular-nums">{mentions.length}</span> mention
        {mentions.length === 1 ? "" : "s"} · last 30 days
      </div>

      <div className="space-y-2.5">
        {mentions.map((m, i) => {
          return (
            <div
              key={i}
              className="grid grid-cols-[3.5rem_auto_minmax(0,1fr)] items-start gap-3 text-xs"
            >
              <SentimentChip value={m.sentiment} />
              <IntensityMeter intensity={m.intensity} />
              <div className="min-w-0">
                <span className="text-ink-muted leading-snug">
                  <span className="text-ink-faint">&ldquo;</span>
                  {m.quote}
                  <span className="text-ink-faint">&rdquo;</span>
                </span>
                <a
                  href={m.episodeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex items-center gap-1.5 text-ink-faint hover:text-ink-body"
                >
                  <span className="truncate">{m.episodeTitle}</span>
                  <span className="tabular-nums shrink-0">· {formatDate(m.publishedAt)}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-ink-faint mt-3">
        Sentiment is −5 (left) … +5 (right) for that issue; intensity is the model&apos;s 1–5
        conviction. Quotes are excerpts, never full transcripts.{" "}
        <a href={`/issues/${issueSlug}`} className="underline hover:text-ink-body">
          See {issueName} across all channels →
        </a>
      </p>
    </div>
  );
}

export function ChannelIssueBreakdown({
  channelId,
  issues,
}: {
  channelId: string;
  issues: IssueOnChannel[];
}) {
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  function toggle(slug: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  return (
    <Card className="divide-y divide-border">
      {issues.map((issue) => {
        const pct = ((issue.lean + 10) / 20) * 100;
        const isOpen = open.has(issue.issue_slug);
        return (
          <div key={issue.issue_slug}>
            <button
              type="button"
              onClick={() => toggle(issue.issue_slug)}
              aria-expanded={isOpen}
              className="w-full text-left px-4 py-3 hover:bg-subtle transition"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium min-w-0">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 shrink-0 text-ink-faint" />
                  ) : (
                    <ChevronRight className="w-4 h-4 shrink-0 text-ink-faint" />
                  )}
                  <span className="truncate">{issue.issue_name}</span>
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums whitespace-nowrap ${leanColor(issue.lean)}`}
                >
                  {formatLean(issue.lean)}
                </span>
              </div>
              <div className="mt-2 relative h-1.5 rounded-full bg-gradient-to-r from-blue-500 via-gray-200 to-red-500">
                <div
                  className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-primary border-2 border-white"
                  style={{ left: `${pct}%`, transform: "translate(-50%, -50%)" }}
                />
              </div>
              <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                {issue.numMentions} mention{issue.numMentions === 1 ? "" : "s"} · weight{" "}
                {issue.weight.toLocaleString()}
              </div>
            </button>
            {isOpen && (
              <IssueMentionsPanel
                channelId={channelId}
                issueSlug={issue.issue_slug}
                issueName={issue.issue_name}
              />
            )}
          </div>
        );
      })}
    </Card>
  );
}
