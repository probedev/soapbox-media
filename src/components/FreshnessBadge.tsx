import { getDataFreshness } from "@/lib/aggregate";
import { DISPLAY_TZ } from "@/lib/utils";

/**
 * The single, site-wide freshness badge - shown in the Header on every page so
 * there's one consistent "how fresh is this" signal instead of the old grab-bag
 * of per-page timestamp treatments. Relative label ("Updated 3h ago") with the
 * absolute pipeline-run time (US Eastern) on hover. Async server component;
 * recomputes per request (public pages are force-dynamic).
 */
function relative(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function absolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: DISPLAY_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export async function FreshnessBadge() {
  const iso = await getDataFreshness();
  if (!iso) return null;
  return (
    <span
      title={`Last pipeline run: ${absolute(iso)}`}
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      Updated {relative(iso)}
    </span>
  );
}
