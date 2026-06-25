"use client";

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Play, ChevronDown } from "lucide-react";
import { timestampedSourceUrl, formatTimestamp } from "@/lib/transcript-timing";

type Receipt = { quote: string; fav: number; intensity: number; startTs: number | null; url: string; title: string };
type Network = { net: string; mean: number | null; n: number; receipts: Receipt[] };
type Story = { slug: string; label: string; window: string; networks: Network[] };

function FavChip({ v }: { v: number }) {
  const cls = v > 0.5 ? "bg-red-100 text-red-700" : v < -0.5 ? "bg-blue-100 text-blue-700" : "bg-muted text-ink-muted";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${cls}`} title="model favorability toward the administration, -5 to +5">
      {v > 0 ? "+" : ""}{v.toFixed(1)}
    </span>
  );
}

function Intensity({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5 items-center" title={`intensity ${n}/5`} aria-label={`intensity ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-1 w-1 rounded-full ${i <= n ? "bg-ink-faint" : "bg-input"}`} />
      ))}
    </span>
  );
}

function ReceiptRow({ r }: { r: Receipt }) {
  return (
    <div className="grid grid-cols-[3rem_auto] items-start gap-2 text-xs py-1.5">
      <FavChip v={r.fav} />
      <span className="text-ink-body leading-snug">
        <span className="text-ink-faint">&ldquo;</span>{r.quote}<span className="text-ink-faint">&rdquo;</span>
        {r.startTs != null && (
          <a
            href={timestampedSourceUrl(r.url, r.startTs)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1.5 inline-flex items-center gap-0.5 align-baseline text-ink-faint hover:text-ink-body whitespace-nowrap"
            title="Watch from this moment"
          >
            <Play className="w-2.5 h-2.5 shrink-0" />
            <span className="tabular-nums">{formatTimestamp(r.startTs)}</span>
          </a>
        )}
      </span>
    </div>
  );
}

export function ReceiptsSection({ stories }: { stories: Story[] }) {
  return (
    <div className="mt-6 space-y-2.5">
      {stories.map((s) => {
        const total = s.networks.reduce((n, x) => n + x.receipts.length, 0);
        return (
          <Collapsible key={s.slug} className="border border-border rounded-md">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-subtle rounded-md">
              <span className="text-sm font-semibold text-ink-strong">{s.label}</span>
              <span className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="tabular-nums">{total} receipts</span>
                <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4">
              <div className="grid sm:grid-cols-2 gap-x-6">
                {s.networks.map((nw) => (
                  <div key={nw.net} className="mt-3">
                    <div className="flex items-center gap-2 border-b border-border pb-1 mb-1">
                      <span className="text-xs font-semibold text-ink-strong">{nw.net}</span>
                      {nw.mean != null && <FavChip v={nw.mean} />}
                      <span className="text-[10px] text-ink-faint tabular-nums">{nw.n} mentions scored</span>
                    </div>
                    <div className="divide-y divide-border/60">
                      {nw.receipts.map((r, i) => <ReceiptRow key={i} r={r} />)}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
