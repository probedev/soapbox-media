import { getEmergingBoard } from "@/lib/discovery";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { EmergingBoard } from "@/components/EmergingBoard";
import { DISPLAY_TZ } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Relative "last refreshed" label for the board's most recent rebuild. */
function refreshedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffH = Math.floor((Date.now() - t) / 3_600_000);
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function refreshedAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: DISPLAY_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

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
          off-taxonomy subjects our classifier flags, cluster them into candidate issues, and rank them
          by reach, recency, and momentum: an issue accelerating this week outranks a bigger one that has
          plateaued or is fading, so the top is what&apos;s emerging, not just what&apos;s loudest.
          Recent episodes count for far more (a topic&apos;s weight halves about every week), and issues
          the shows stop talking about drop off the board entirely. The
          <span className="text-emerald-600 font-medium"> &uarr;</span>/&darr; column shows how each
          issue moved since the last refresh, and a <span className="text-amber-700 font-medium">flame</span>
          marks issues breaking out: mentioned far more this week than last. Switch between independent and legacy outlets to see
          where the two diverge. These are raw, auto-detected signals, refreshed daily and not
          hand-curated; whether one becomes a tracked Soapbox issue stays a human call. Expand any row
          for the receipts: the exact things shows said, with links to the episodes.
        </p>
        {refreshedLabel(board.lastUpdated) && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Board refreshed {refreshedLabel(board.lastUpdated)}
            <span className="text-ink-faint">· {refreshedAbsolute(board.lastUpdated!)}</span>
          </div>
        )}

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
            />
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
