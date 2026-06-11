interface TrustStripProps {
  numChannels: number;
  numEpisodes: number;
  /** Short label for the current period, e.g. "Last 7 days" or "As of May 11, 2026" */
  asOfLabel: string;
  isPlaceholder?: boolean;
}

// Freshness ("last updated") now lives in the single header FreshnessBadge, so
// this strip carries only the scope of the reading (window + panel size).
export function TrustStrip({
  numChannels,
  numEpisodes,
  asOfLabel,
  isPlaceholder = false,
}: TrustStripProps) {
  return (
    <div className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      <span>{asOfLabel}</span>
      <span aria-hidden>·</span>
      <span>
        <span className="font-semibold text-ink-body tabular-nums">{numChannels}</span>{" "}
        channels
      </span>
      <span aria-hidden>·</span>
      <span>
        <span className="font-semibold text-ink-body tabular-nums">
          {numEpisodes.toLocaleString()}
        </span>{" "}
        episodes tracked
      </span>
      {isPlaceholder && (
        <>
          <span aria-hidden>·</span>
          <span className="text-amber-600 font-medium">
            Pipeline online, awaiting first sentiment data
          </span>
        </>
      )}
    </div>
  );
}
