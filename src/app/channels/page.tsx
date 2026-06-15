import { createServiceClient } from "@/lib/db";
import { PUBLIC_COHORTS } from "@/lib/cohort";
import { CohortLegend } from "@/components/CohortLegend";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PanelBalance } from "@/components/PanelBalance";
import { PanelScale } from "@/components/PanelScale";
import { ChannelsBrowser, type ShowRow, type PlatformRef } from "@/components/ChannelsBrowser";

export const dynamic = "force-dynamic";

interface ChannelRow {
  id: string;
  name: string;
  platform: "youtube" | "podcast";
  platform_id: string;
  political_lean: "L" | "M" | "R";
  reach: number | bigint;
  classification_rationale: string | null;
  cohort: "independent" | "legacy";
}

/**
 * Collapse same-name channel rows (e.g. Ben Shapiro Podcast + Ben Shapiro
 * YouTube) into one show. Backend keeps separate rows per (show, platform)
 * for ingest reasons; UI treats each show as one entity.
 */
function groupByShow(rows: ChannelRow[]): ShowRow[] {
  const byName = new Map<string, ChannelRow[]>();
  for (const r of rows) {
    const arr = byName.get(r.name) || [];
    arr.push(r);
    byName.set(r.name, arr);
  }

  const shows: ShowRow[] = [];
  for (const [name, group] of byName) {
    const canonical = group.find((g) => g.platform === "podcast") || group[0];
    const platforms: PlatformRef[] = group.map((g) => ({
      platform: g.platform,
      channel_id: g.id,
      platform_id: g.platform_id,
      reach: Number(g.reach) || 0,
    }));
    const maxReach = Math.max(...platforms.map((p) => p.reach));
    shows.push({
      canonical_id: canonical.id,
      name,
      political_lean: canonical.political_lean,
      platforms,
      maxReach,
      classification_rationale: canonical.classification_rationale,
      cohort: canonical.cohort,
    });
  }
  return shows.sort((a, b) => b.maxReach - a.maxReach);
}

export default async function ChannelsListPage() {
  const db = createServiceClient();
  // Paginate by `id` (stable PK) and terminate only on an empty page - see
  // [[pagination-stable-order]]. A single `.range(0, 999)` silently truncates
  // at 1000 active channels. JS re-sorts via groupByShow → maxReach.
  const rows: ChannelRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("channels")
      .select(
        "id, name, platform, platform_id, political_lean, reach, classification_rationale, cohort",
      )
      .eq("active", true)
      .in("cohort", [...PUBLIC_COHORTS])
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as ChannelRow[]));
  }
  const shows = groupByShow(rows);

  return (
    <main className="min-h-screen">
      <Header activePage="channels" />

      <section className="px-6 pt-10 pb-16 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            <a href="/" className="hover:text-ink-body">
              ← Soapbox Index
            </a>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Channels we track
          </h1>
          <p className="text-ink-muted mt-3 leading-relaxed max-w-3xl">
            {shows.length} hand-curated alt-media political shows, balanced across
            Left, Middle, and Right publishing posture. YouTube subscriber counts
            refresh daily during the ingest pass; podcast audience estimates are
            editorial and reviewed at panel-add time. Lean classifications are
            editorial and reviewed quarterly. See the{" "}
            <a href="/methodology" className="underline hover:text-foreground">
              methodology page
            </a>{" "}
            for selection criteria, or the{" "}
            <a href="/log" className="underline hover:text-foreground">
              pipeline log
            </a>{" "}
            for system scale and daily health.
          </p>

          {/* Magnitude first (PanelScale), distribution second (PanelBalance),
              then the searchable / cohort-tabbed list. */}
          <PanelScale />
          <PanelBalance shows={shows} />

          {PUBLIC_COHORTS.length > 1 && (
            <div className="flex justify-end mt-6">
              <CohortLegend />
            </div>
          )}

          <ChannelsBrowser shows={shows} showCohort={PUBLIC_COHORTS.length > 1} />
      </section>

      <Footer />
    </main>
  );
}
