import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { LeanSplitBar } from "@/components/LeanSplitBar";
import {
  getAdvertisersOverview,
  readAdvertisersBoard,
  adWindowSinceIso,
  AD_WINDOW_CHOICES,
  type AdWindowKey,
} from "@/lib/aggregate";

export const dynamic = "force-dynamic";

function airtime(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 6000) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export default async function AdvertisersPage({
  searchParams,
}: {
  searchParams?: { w?: string };
}) {
  const choice =
    AD_WINDOW_CHOICES.find((c) => c.key === (searchParams?.w as AdWindowKey)) ??
    AD_WINDOW_CHOICES[0];
  // Precomputed daily by /api/cron/boards (v0.40.0). The live path is the
  // fallback for a missing or stale (>48h) snapshot only - it is the slow one.
  const advertisers =
    (await readAdvertisersBoard(choice.key).catch(() => null)) ??
    (await getAdvertisersOverview(adWindowSinceIso(choice.key)));
  const windowLabel =
    choice.key === "all"
      ? "since dense panel coverage began (May 2026)"
      : `over the last ${choice.label}`;

  return (
    <main className="min-h-screen">
      <Header activePage="advertisers" />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Advertisers</h1>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed max-w-3xl">
          Who underwrites online political media - and which side of it. Each row counts{" "}
          <strong>detected host-read sponsor messages</strong> across the tracked panel{" "}
          {windowLabel}, with the placement bar showing the reach-weighted share landing on{" "}
          <span className="text-blue-600 font-medium">left-leaning</span>, middle, and{" "}
          <span className="text-red-600 font-medium">right-leaning</span> shows. Detections
          come from transcript pattern-matching confirmed by a language model against short
          excerpts; they are estimates of on-air sponsor reads, not verified commercial
          contracts, and produced ad spots inserted by platforms are out of scope. Every
          claim links to its receipt on the advertiser page.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-sm" role="tablist" aria-label="Time window">
            {AD_WINDOW_CHOICES.map((c) => (
              <Link
                key={c.key}
                href={c.key === "30" ? "/advertisers" : `/advertisers?w=${c.key}`}
                role="tab"
                aria-selected={c.key === choice.key}
                className={
                  c.key === choice.key
                    ? "px-3 py-1 rounded-full bg-foreground text-background font-medium"
                    : "px-3 py-1 rounded-full text-ink-muted hover:bg-subtle hover:text-foreground transition-colors"
                }
              >
                {c.label}
              </Link>
            ))}
          </div>
          <span className="text-xs text-ink-faint">
            {advertisers.length.toLocaleString()} advertisers
          </span>
        </div>

        <div className="mt-3 mb-2 hidden sm:flex items-center justify-end gap-6 pr-4 text-[11px] uppercase tracking-wider text-ink-faint">
          <span className="w-16 text-right">Reads</span>
          <span className="w-14 text-right">Shows</span>
          <span className="w-14 text-right">Airtime</span>
          <span className="w-24 text-right">Placement</span>
        </div>
        <Card className="divide-y divide-border">
          {advertisers.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-faint">
              No confirmed sponsor reads in this window yet.
            </p>
          ) : (
            advertisers.map((a) => (
              <Link
                key={a.slug}
                href={`/advertisers/${a.slug}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-subtle transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.name}</div>
                  {a.domain ? (
                    <div className="text-xs text-ink-faint truncate">{a.domain}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-6 whitespace-nowrap text-sm">
                  <span className="w-16 text-right tabular-nums">{a.adReads.toLocaleString()}</span>
                  <span className="w-14 text-right tabular-nums text-ink-muted">{a.shows}</span>
                  <span className="w-14 text-right tabular-nums text-ink-muted">
                    {airtime(a.estSeconds)}
                  </span>
                  <LeanSplitBar share={a.leanShare} />
                </div>
              </Link>
            ))
          )}
        </Card>
      </section>
      <Footer />
    </main>
  );
}
