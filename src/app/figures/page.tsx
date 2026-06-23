import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { FavorabilityGauge } from "@/components/FavorabilityGauge";
import { getFiguresOverview, FIGURE_WINDOW_DAYS } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

const AFFIL_LABEL: Record<string, string> = {
  D: "Democrat", R: "Republican", foreign: "Foreign", tech: "Tech", media: "Media",
};

export default async function FiguresPage() {
  const figures = await getFiguresOverview(FIGURE_WINDOW_DAYS);

  return (
    <main className="min-h-screen">
      <Header activePage="figures" />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Public Figures</h1>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed max-w-3xl">
          How favorably vs critically the tracked panel talks about each figure, over the
          last {FIGURE_WINDOW_DAYS} days. Favorability runs from{" "}
          <span className="text-slate-600 font-medium">−5 (critical)</span> to{" "}
          <span className="text-emerald-700 font-medium">+5 (favorable)</span>, reach- and
          intensity-weighted across stance-bearing mentions. This is a{" "}
          <strong>separate axis from the left/right Soapbox Index</strong> - a figure can be
          loved or loathed across party lines - so it never moves the needle. Passing
          name-drops and benchmark references are excluded. (Trump is held for a later
          release; he saturates the corpus.)
        </p>

        <Card className="mt-6 divide-y divide-border">
          {figures.map((f) => (
            <Link
              key={f.slug}
              href={`/figures/${f.slug}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-subtle transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{f.name}</div>
                <div className="text-xs text-ink-faint">
                  {f.affiliation ? `${AFFIL_LABEL[f.affiliation] ?? f.affiliation} · ` : ""}
                  {f.mentions.toLocaleString()} mention{f.mentions === 1 ? "" : "s"}
                </div>
              </div>
              <FavorabilityGauge value={f.favorability} scoredCount={f.scored} />
            </Link>
          ))}
        </Card>
      </section>
      <Footer />
    </main>
  );
}
