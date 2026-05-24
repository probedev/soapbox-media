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

// ── Per-episode pipeline stage dots ───────────────────────────────────────

type StepState = "done" | "failed" | "partial" | "pending" | "na";

const STEP_DOT: Record<StepState, string> = {
  done: "bg-emerald-500",
  failed: "bg-red-500",
  partial: "bg-amber-400",
  pending: "bg-gray-300",
  na: "bg-gray-200",
};

const STAGE_COLS = ["Ingested", "Transcribed", "Classified", "Scored"] as const;

function stageStates(p: EpisodePipeline): { state: StepState; title: string }[] {
  return [
    { state: "done", title: "Ingested" },
    { state: p.transcribed, title: `Transcribed: ${p.transcribed}` },
    {
      state: p.classified,
      title:
        p.classified === "na"
          ? "Classify: skipped (no transcript)"
          : p.classified === "done"
            ? `Classified: ${p.classificationCount} mentions`
            : "Classify: pending",
    },
    {
      state: p.scored,
      title:
        p.scored === "na"
          ? "Scored: no issues to score"
          : `Scored: ${p.scoredCount}/${p.classificationCount}`,
    },
  ];
}

function Dot({ state, title }: { state: StepState; title: string }) {
  return (
    <span className="inline-flex items-center justify-center" title={title}>
      <span className={`w-2.5 h-2.5 rounded-full ${STEP_DOT[state]}`} />
    </span>
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
    <div className="border border-gray-200 rounded-lg bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
            <th className="text-left font-medium px-4 py-2.5">Episode</th>
            {STAGE_COLS.map((c) => (
              <th key={c} className="font-medium px-2 py-2.5 w-24 text-center">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {episodes.map((ep) => {
            const states = ep.pipeline ? stageStates(ep.pipeline) : null;
            return (
              <tr key={ep.id} className="align-top">
                <td className="px-4 py-3">
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
                          <span className="text-gray-400">
                            ({platformLabel(ep.channel.platform)})
                          </span>
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
                </td>
                {states
                  ? states.map((s, i) => (
                      <td key={i} className="px-2 py-3 text-center">
                        <Dot state={s.state} title={s.title} />
                      </td>
                    ))
                  : STAGE_COLS.map((_, i) => (
                      <td key={i} className="px-2 py-3 text-center text-gray-300">
                        –
                      </td>
                    ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
