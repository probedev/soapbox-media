import { getEmergingBoard } from "@/lib/discovery";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { EmergingBoard } from "@/components/EmergingBoard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Emerging issues · Soapbox",
  description:
    "Political issues alt-media is talking about that aren't in our taxonomy yet - auto-detected, clustered, and ranked by reach, split by independent vs legacy, with episode receipts. Refreshed daily.",
};

export default async function EmergingPage() {
  const board = await getEmergingBoard();

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
          reach &times; recency &times; volume. Switch between independent and legacy outlets to see
          where the two diverge. These are raw, auto-detected signals, refreshed daily and not
          hand-curated; whether one becomes a tracked Soapbox issue stays a human call. Expand any row
          for the receipts: the exact things shows said, with links to the episodes.
        </p>

        <div className="mt-8">
          {board.all.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              No emerging issues right now. Check back after the next daily refresh.
            </div>
          ) : (
            <EmergingBoard
              all={board.all}
              independent={board.independent}
              legacy={board.legacy}
              lastUpdated={board.lastUpdated}
            />
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
