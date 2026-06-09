import { getEmergingIssues } from "@/lib/discovery";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/badge";
import { EmergingIssuesTable } from "@/components/EmergingIssuesTable";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Emerging issues · Soapbox",
  description:
    "Political issues alt-media is talking about that aren't in our taxonomy yet - auto-detected, clustered, and ranked by reach, with episode receipts. Refreshed daily.",
};

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function EmergingPage() {
  const { issues, lastUpdated } = await getEmergingIssues();

  return (
    <main className="min-h-screen">
      <Header activePage="emerging" />

      <section className="px-6 pt-10 pb-16 max-w-5xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          <a href="/" className="hover:text-ink-body">← Soapbox Index</a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Emerging issues</h1>
        <p className="text-ink-muted mt-3 text-sm leading-relaxed max-w-3xl">
          Issues the shows are talking about that aren&apos;t in our taxonomy yet. We harvest the
          off-taxonomy subjects our classifier flags, cluster them into candidate issues, and rank by
          reach &times; recency &times; volume. These are raw, auto-detected signals, refreshed daily
          and not hand-curated; whether one becomes a tracked Soapbox issue stays a human call. Expand
          any row for the receipts: the exact things shows said, with links to the episodes.
        </p>

        <div className="mt-8">
          {issues.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              No emerging issues right now. Check back after the next daily refresh.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {issues.length} emerging issue{issues.length === 1 ? "" : "s"}
                </span>
                {lastUpdated && (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    Updated {formatUpdated(lastUpdated)}
                  </Badge>
                )}
              </div>
              <EmergingIssuesTable data={issues} />
            </>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
