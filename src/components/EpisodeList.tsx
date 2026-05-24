import type { EpisodeListItem, EpisodePipeline } from "@/lib/episodes";
import { ExternalLink } from "lucide-react";

interface EpisodeListProps {
  episodes: EpisodeListItem[];
  /** When true, prepend each row with the channel lean badge + linked name. */
  showChannel?: boolean;
  emptyMessage?: string;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function platformLabel(p: "youtube" | "podcast"): string {
  return p === "youtube" ? "YT" : "Pod";
}

function leanStyle(lean: "L" | "M" | "R"): string {
  switch (lean) {
    case "L":
      return "bg-blue-100 text-blue-800";
    case "R":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

// ── Per-episode pipeline tracker ──────────────────────────────────────────

type StepState = "done" | "failed" | "partial" | "pending" | "na";

const STEP_DOT: Record<StepState, string> = {
  done: "bg-emerald-500",
  failed: "bg-red-500",
  partial: "bg-amber-400",
  pending: "bg-gray-300",
  na: "bg-gray-200",
};

const STEP_TEXT: Record<StepState, string> = {
  done: "text-emerald-700",
  failed: "text-red-700",
  partial: "text-amber-700",
  pending: "text-gray-400",
  na: "text-gray-300",
};

function Step({
  label,
  state,
  title,
}: {
  label: string;
  state: StepState;
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] ${STEP_TEXT[state]}`}
      title={title || `${label}: ${state}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${STEP_DOT[state]}`} />
      {label}
    </span>
  );
}

function PipelineTracker({ p }: { p: EpisodePipeline }) {
  const scoredTitle =
    p.scored === "na"
      ? "Scored: no issues to score"
      : `Scored: ${p.scoredCount}/${p.classificationCount}`;
  const classifiedTitle =
    p.classified === "na"
      ? "Classify: skipped (no transcript)"
      : p.classified === "done"
        ? `Classified: ${p.classificationCount} mentions`
        : "Classify: pending";

  return (
    <div className="flex items-center gap-2.5 flex-wrap justify-end shrink-0">
      <Step label="Ingested" state="done" title="Ingested" />
      <Step label="Transcribed" state={p.transcribed} title={`Transcribe: ${p.transcribed}`} />
      <Step label="Classified" state={p.classified} title={classifiedTitle} />
      <Step label="Scored" state={p.scored} title={scoredTitle} />
    </div>
  );
}

export function EpisodeList({
  episodes,
  showChannel = false,
  emptyMessage,
}: EpisodeListProps) {
  if (episodes.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        {emptyMessage || "No episodes."}
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
      {episodes.map((ep) => (
        <div key={ep.id} className="px-4 py-3 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              {showChannel && ep.channel && (
                <>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanStyle(ep.channel.political_lean)}`}
                  >
                    {ep.channel.political_lean}
                  </span>
                  <a
                    href={`/channels/${ep.channel.id}`}
                    className="text-xs text-gray-600 hover:text-gray-900 truncate"
                  >
                    {ep.channel.name}{" "}
                    <span className="text-gray-400">({platformLabel(ep.channel.platform)})</span>
                  </a>
                  <span aria-hidden className="text-gray-300">
                    ·
                  </span>
                </>
              )}
              <a
                href={ep.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-gray-900 hover:underline inline-flex items-center gap-1 min-w-0"
              >
                <span className="truncate">{ep.title}</span>
                <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
              </a>
            </div>
            <div className="text-xs text-gray-500 mt-1 tabular-nums">
              {formatDate(ep.published_at)}
              {formatDuration(ep.duration_sec) && (
                <> · {formatDuration(ep.duration_sec)}</>
              )}
            </div>
          </div>
          {ep.pipeline && <PipelineTracker p={ep.pipeline} />}
        </div>
      ))}
    </div>
  );
}
