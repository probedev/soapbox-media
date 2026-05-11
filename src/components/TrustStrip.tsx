interface TrustStripProps {
  numChannels: number;
  numEpisodes: number;
  /** ISO string of the most recent data update */
  lastUpdated: string;
  /** Short label for the current period, e.g. "Last 7 days" or "As of May 11, 2026" */
  asOfLabel: string;
  isPlaceholder?: boolean;
}

export function TrustStrip({
  numChannels,
  numEpisodes,
  lastUpdated,
  asOfLabel,
  isPlaceholder = false,
}: TrustStripProps) {
  const date = new Date(lastUpdated);
  const formatted = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <div className="text-xs text-gray-500 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      <span>{asOfLabel}</span>
      <span aria-hidden>·</span>
      <span>
        <span className="font-semibold text-gray-700 tabular-nums">{numChannels}</span>{" "}
        channels
      </span>
      <span aria-hidden>·</span>
      <span>
        <span className="font-semibold text-gray-700 tabular-nums">
          {numEpisodes.toLocaleString()}
        </span>{" "}
        episodes in window
      </span>
      <span aria-hidden>·</span>
      <span>Last updated {formatted}</span>
      {isPlaceholder && (
        <>
          <span aria-hidden>·</span>
          <span className="text-amber-600 font-medium">
            Pipeline online — awaiting first sentiment data
          </span>
        </>
      )}
    </div>
  );
}
