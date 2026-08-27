import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { LeanSplitBar } from "@/components/LeanSplitBar";
import { leanChipStyle } from "@/lib/lean";
import { AdvertiserTrendChart } from "@/components/AdvertiserTrendChart";
import { getAdvertiserDetail, type AdReceipt } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

function airtime(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtTs(ts: number): string {
  const h = Math.floor(ts / 3600);
  const m = Math.floor((ts % 3600) / 60);
  const s = ts % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function Receipt({ r }: { r: AdReceipt }) {
  const chip = leanChipStyle(r.lean);
  return (
    <Card className="p-3">
      <p className="text-sm text-ink-body leading-relaxed">
        &ldquo;{r.excerpt.length > 340 ? `${r.excerpt.slice(0, 340)}...` : r.excerpt}&rdquo;
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${chip.cls}`}>{r.lean}</span>
        <span className="font-medium text-ink-muted">{r.channelName}</span>
        <span>{fmtDate(r.publishedAt)}</span>
        <a
          href={r.timestampUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          {r.startTs != null ? `source at ${fmtTs(r.startTs)}` : "source"}
        </a>
      </div>
    </Card>
  );
}

export default async function AdvertiserPage({ params }: { params: { slug: string } }) {
  const adv = await getAdvertiserDetail(params.slug);
  if (!adv) notFound();
  const since = adv.firstSeen
    ? new Date(adv.firstSeen).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <main className="min-h-screen">
      <Header activePage="advertisers" />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{adv.name}</h1>
          {adv.domain ? <span className="text-sm text-ink-faint">{adv.domain}</span> : null}
        </div>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed max-w-3xl">
          {adv.adReads.toLocaleString()} detected host-read sponsor message
          {adv.adReads === 1 ? "" : "s"} across {adv.showCount} show
          {adv.showCount === 1 ? "" : "s"}
          {since ? ` since ${since}` : ""}, roughly {airtime(adv.estSeconds)} of read time.
          Detections are model-confirmed transcript excerpts - estimates, not verified
          contracts.
        </p>
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-faint">
          <span>Reach-weighted placement:</span>
          <LeanSplitBar share={adv.leanShare} className="w-40" />
          <span className="tabular-nums">
            {Math.round(adv.leanShare.left * 100)}% left · {Math.round(adv.leanShare.middle * 100)}%
            middle · {Math.round(adv.leanShare.right * 100)}% right
          </span>
        </div>

        {adv.trend.length >= 2 ? (
          <div className="mt-8">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Placement history
            </h3>
            <Card className="p-4">
              <AdvertiserTrendChart trend={adv.trend} />
            </Card>
          </div>
        ) : null}

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Shows carrying this advertiser
            </h3>
            <Card className="divide-y divide-border">
              {adv.shows.map((s) => {
                const chip = leanChipStyle(s.lean);
                return (
                  <div
                    key={s.channelId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${chip.cls}`}>
                        {s.lean}
                      </span>
                      <a
                        href={`/channels/${s.channelId}`}
                        className="truncate hover:text-foreground hover:underline"
                      >
                        {s.channelName}
                      </a>
                    </div>
                    <div className="flex items-center gap-3 whitespace-nowrap text-xs text-ink-faint tabular-nums">
                      <span>{s.adReads}×</span>
                      <span>{airtime(s.estSeconds)}</span>
                      <span>{fmtDate(s.lastSeen)}</span>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Recent receipts
            </h3>
            <div className="space-y-3">
              {adv.receipts.map((r, i) => (
                <Receipt key={i} r={r} />
              ))}
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
