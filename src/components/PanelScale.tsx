/**
 * PanelScale - composition stats card for /channels.
 *
 * Mirrors the visual rhythm of SystemStats on /log, but the numbers are
 * about the panel itself (who we track) rather than the pipeline's
 * processing scale. This separation matters: a reader on /channels is
 * asking "is this panel representative?", a reader on /log is asking "is
 * the pipeline running?". Same component shape, different question.
 *
 * Sits ABOVE <PanelBalance> on the page so readers see magnitude (raw
 * numbers) before distribution (stacked bars). Both surfaces use the same
 * unique-show reach methodology.
 */
import { Mic, Tv } from "lucide-react";
import { getPanelStats } from "@/lib/aggregate";
import { Card } from "@/components/ui/card";

function relativeTime(iso: string | null): string {
  if (!iso) return "-";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffH / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  return `${diffDay}d ago`;
}

function compactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

interface StatProps {
  value: string;
  label: string;
  sublabel?: string;
}

function Stat({ value, label, sublabel }: StatProps) {
  return (
    <div>
      <div className="text-3xl md:text-4xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mt-2 font-medium">
        {label}
      </div>
      {sublabel && (
        <div className="text-[11px] text-ink-faint mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}

export async function PanelScale() {
  const stats = await getPanelStats();
  const leanCount = `${stats.channelsByLean.L} L · ${stats.channelsByLean.M} M · ${stats.channelsByLean.R} R`;
  const reachByLean =
    `${compactNumber(stats.audienceReachByLean.L)} L · ` +
    `${compactNumber(stats.audienceReachByLean.M)} M · ` +
    `${compactNumber(stats.audienceReachByLean.R)} R`;
  const platformSplit =
    `${stats.platformSplit.youtube} YouTube · ${stats.platformSplit.podcast} Podcast`;

  return (
    <Card className="p-6 mt-6">
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          Panel scale
        </h2>
        {/* Freshness signal is YT-specific. Podcast reach is intentionally
            editorial (PodScan's audience_size is unreliable; see v0.6.58
            CHANGELOG) so we don't claim podcasts are auto-refreshed. */}
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {stats.lastReachSync
            ? `YouTube subs refreshed ${relativeTime(stats.lastReachSync)} · podcast reach editorial`
            : "composition · not processing"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Stat
          value={stats.showsTracked.toString()}
          label="Shows tracked"
          sublabel={leanCount}
        />
        <Stat
          value={compactNumber(stats.audienceReach)}
          label="Combined audience"
          sublabel={reachByLean}
        />
        <Stat
          value={stats.platformRows.toString()}
          label="Platform rows"
          sublabel={platformSplit}
        />
        <Stat
          value={stats.episodesIngested24h.toLocaleString()}
          label="Episodes ingested"
          sublabel="in the last 24 hours"
        />
      </div>

      {stats.channelsByCohort.legacy > 0 && (
        <div className="mt-5 pt-4 border-t border-muted flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-muted">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            By cohort
          </span>
          <span className="flex items-center gap-1.5">
            <Mic className="h-3.5 w-3.5 text-emerald-600" />
            <span className="tabular-nums">{stats.channelsByCohort.independent}</span>{" "}
            independent ·{" "}
            <span className="tabular-nums">
              {compactNumber(stats.audienceReachByCohort.independent)}
            </span>{" "}
            reach
          </span>
          <span className="flex items-center gap-1.5">
            <Tv className="h-3.5 w-3.5 text-amber-500" />
            <span className="tabular-nums">{stats.channelsByCohort.legacy}</span> legacy
            ·{" "}
            <span className="tabular-nums">
              {compactNumber(stats.audienceReachByCohort.legacy)}
            </span>{" "}
            reach
          </span>
        </div>
      )}
    </Card>
  );
}
