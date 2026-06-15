"use client";

/**
 * ChannelsBrowser - the filterable show list on /channels. Cohort tabs (All /
 * Independent / Legacy, mirroring /emerging) plus a name search, over the
 * existing Left / Middle / Right lean buckets. Pure client filtering of the
 * server-provided show list (no refetch). The panel-scale / balance cards and
 * the data fetch stay on the server page.
 */
import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InfoTip } from "@/components/InfoTip";
import { Input } from "@/components/ui/input";
import { CohortBadge } from "@/components/CohortBadge";
import { getChannelExternalUrl } from "@/lib/channelLinks";
import { leanChipStyle } from "@/lib/lean";
import { ExternalLink, Search } from "lucide-react";

export interface PlatformRef {
  platform: "youtube" | "podcast";
  channel_id: string;
  platform_id: string;
  reach: number;
}

export interface ShowRow {
  canonical_id: string;
  name: string;
  political_lean: "L" | "M" | "R";
  platforms: PlatformRef[];
  maxReach: number;
  classification_rationale: string | null;
  cohort: "independent" | "legacy";
}

function platformAbbrev(p: "youtube" | "podcast"): string {
  return p === "youtube" ? "YT" : "Pod";
}

function ShowCard({ show, showCohort }: { show: ShowRow; showCohort: boolean }) {
  const platformText = show.platforms.map((p) => platformAbbrev(p.platform)).join(" · ");
  return (
    <div className="relative border border-border bg-card rounded-lg hover:border-ink-faint hover:shadow-sm transition group">
      <a href={`/channels/${show.canonical_id}`} className="block p-4 pr-20">
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium text-foreground flex items-center gap-2">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanChipStyle(show.political_lean).cls}`}>
              {show.political_lean}
            </span>
            {showCohort && <CohortBadge cohort={show.cohort} />}
            {show.name}
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-1 tabular-nums">
          Reach: {show.maxReach.toLocaleString()}
          <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-faint">
            {platformText}
          </span>
        </div>
        {show.classification_rationale && (
          <div className="text-xs text-ink-muted mt-2 leading-snug line-clamp-2">
            {show.classification_rationale}
          </div>
        )}
      </a>
      <div className="absolute top-3 right-3 flex items-center gap-0.5">
        {show.platforms.map((p) => {
          const ext = getChannelExternalUrl({
            platform: p.platform,
            platform_id: p.platform_id,
            name: show.name,
          });
          return (
            <InfoTip key={p.platform} label={`${ext.label} (${platformAbbrev(p.platform)})`}>
              <a
                href={ext.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${ext.label} (${platformAbbrev(p.platform)})`}
                className="inline-flex items-center gap-0.5 text-ink-faint hover:text-foreground px-1 py-1 opacity-60 group-hover:opacity-100 transition"
              >
                <span className="text-[9px] font-semibold uppercase tracking-wider">
                  {platformAbbrev(p.platform)}
                </span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </InfoTip>
          );
        })}
      </div>
    </div>
  );
}

const LEAN_LABEL: Record<"L" | "M" | "R", string> = {
  L: "Left-leaning",
  M: "Middle / cross-cutting",
  R: "Right-leaning",
};

function LeanGrid({ shows, showCohort }: { shows: ShowRow[]; showCohort: boolean }) {
  const byLean = {
    L: shows.filter((s) => s.political_lean === "L"),
    M: shows.filter((s) => s.political_lean === "M"),
    R: shows.filter((s) => s.political_lean === "R"),
  };
  if (shows.length === 0) {
    return <div className="text-sm text-muted-foreground italic py-8">No shows match.</div>;
  }
  return (
    <>
      {(["L", "M", "R"] as const).map((bucket) =>
        byLean[bucket].length === 0 ? null : (
          <section key={bucket} className="mt-8 first:mt-2">
            <h2 className="text-lg font-semibold mb-3">
              {LEAN_LABEL[bucket]}{" "}
              <span className="text-ink-faint text-sm font-normal">({byLean[bucket].length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byLean[bucket].map((show) => (
                <ShowCard key={show.name} show={show} showCohort={showCohort} />
              ))}
            </div>
          </section>
        ),
      )}
    </>
  );
}

export function ChannelsBrowser({ shows, showCohort }: { shows: ShowRow[]; showCohort: boolean }) {
  const [q, setQ] = React.useState("");
  const norm = q.trim().toLowerCase();
  const filtered = norm ? shows.filter((s) => s.name.toLowerCase().includes(norm)) : shows;

  const independent = filtered.filter((s) => s.cohort === "independent");
  const legacy = filtered.filter((s) => s.cohort === "legacy");

  return (
    <Tabs defaultValue="all" className="mt-10">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <TabsList>
          <TabsTrigger value="all">
            All<span className="ml-1.5 tabular-nums text-xs opacity-70">{filtered.length}</span>
          </TabsTrigger>
          <TabsTrigger value="independent">
            Independent<span className="ml-1.5 tabular-nums text-xs opacity-70">{independent.length}</span>
          </TabsTrigger>
          <TabsTrigger value="legacy">
            Legacy<span className="ml-1.5 tabular-nums text-xs opacity-70">{legacy.length}</span>
          </TabsTrigger>
        </TabsList>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search shows…"
            className="pl-8 h-9 w-full sm:w-56"
            aria-label="Search shows by name"
          />
        </div>
      </div>

      <TabsContent value="all">
        <LeanGrid shows={filtered} showCohort={showCohort} />
      </TabsContent>
      <TabsContent value="independent">
        <LeanGrid shows={independent} showCohort={showCohort} />
      </TabsContent>
      <TabsContent value="legacy">
        <LeanGrid shows={legacy} showCohort={showCohort} />
      </TabsContent>
    </Tabs>
  );
}
