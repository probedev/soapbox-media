import type { EpisodeListItem } from "@/lib/episodes";
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

function statusStyle(s: string): string {
  switch (s) {
    case "fetched":
      return "bg-green-100 text-green-800";
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "skipped":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
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
        <div key={ep.id} className="px-4 py-3 flex items-start gap-3">
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
                    {ep.channel.name}
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
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${statusStyle(ep.transcript_status)}`}
          >
            {ep.transcript_status}
          </span>
        </div>
      ))}
    </div>
  );
}
