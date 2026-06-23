import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { leanChipStyle } from "@/lib/lean";
import { FavorabilityGauge } from "@/components/FavorabilityGauge";
import { getFigureDetail, FIGURE_WINDOW_DAYS, type FigureChannelStance, type FigureReceipt } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

const AFFIL_LABEL: Record<string, string> = {
  D: "Democrat", R: "Republican", foreign: "Foreign", tech: "Tech", media: "Media",
};

function favText(v: number): { text: string; cls: string } {
  const s = v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  if (v > 0.25) return { text: s, cls: "text-emerald-700" };
  if (v < -0.25) return { text: s, cls: "text-slate-600" };
  return { text: s, cls: "text-ink-faint" };
}

function ChannelList({ title, rows }: { title: string; rows: FigureChannelStance[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-faint">Not enough channel volume yet.</p>
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((c) => {
            const f = favText(c.favorability);
            return (
              <div key={c.channelName} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanChipStyle(c.lean).cls}`}>{c.lean}</span>
                  <span className="truncate">{c.channelName}</span>
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <span className="text-xs text-ink-faint tabular-nums">{c.mentions}×</span>
                  <span className={`text-xs font-medium tabular-nums ${f.cls}`}>{f.text}</span>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Receipts({ title, rows }: { title: string; rows: FigureReceipt[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-2">{title}</h3>
      <div className="space-y-3">
        {rows.map((r, i) => {
          const f = favText(r.favorability);
          return (
            <Card key={i} className="p-3">
              <p className="text-sm leading-relaxed text-ink-body">&ldquo;{r.quote.trim()}&rdquo;</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanChipStyle(r.lean).cls}`}>{r.lean}</span>
                <span className="font-medium text-ink-muted">{r.channelName}</span>
                <span className="tabular-nums">{new Date(r.publishedAt).toLocaleDateString()}</span>
                <span className={`font-medium tabular-nums ${f.cls}`}>favorability {f.text}</span>
                {r.sourceUrl && (
                  <a href={r.timestampUrl} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
                    {r.startTs != null ? `▶ ${Math.floor(r.startTs / 60)}:${String(r.startTs % 60).padStart(2, "0")}` : "source"}
                  </a>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default async function FigurePage({ params }: { params: { slug: string } }) {
  const d = await getFigureDetail(params.slug, FIGURE_WINDOW_DAYS);
  if (!d) notFound();

  return (
    <main className="min-h-screen">
      <Header activePage="figures" />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <a href="/figures" className="text-sm text-ink-muted hover:text-foreground">← Figures</a>
        <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight">{d.name}</h1>
        <div className="mt-1 text-sm text-ink-faint">
          {d.affiliation ? `${AFFIL_LABEL[d.affiliation] ?? d.affiliation} · ` : ""}
          {d.mentions.toLocaleString()} mentions, {d.scored.toLocaleString()} stance-bearing, last {FIGURE_WINDOW_DAYS} days
        </div>
        {d.blurb && <p className="mt-3 text-sm text-ink-muted max-w-3xl leading-relaxed">{d.blurb}</p>}

        <Card className="mt-5 p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-3">
            Net favorability (reach × intensity weighted)
          </div>
          <FavorabilityGauge value={d.favorability} scoredCount={d.scored} size="lg" />
          <p className="mt-3 text-xs text-ink-faint max-w-xl leading-relaxed">
            A separate axis from the left/right Index: how positively vs negatively the panel
            portrays {d.name}, not where they fall on the L/R spectrum.
          </p>
        </Card>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <ChannelList title="Most effusive shows" rows={d.mostEffusive} />
          <ChannelList title="Most critical shows" rows={d.mostCritical} />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Receipts title="Most favorable quotes" rows={d.topPositive} />
          <Receipts title="Most critical quotes" rows={d.topNegative} />
        </div>
      </section>
      <Footer />
    </main>
  );
}
