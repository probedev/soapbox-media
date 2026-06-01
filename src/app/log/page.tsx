import { EpisodeDataTable } from "@/components/EpisodeDataTable";
import { SystemStats } from "@/components/SystemStats";
import { CohortLegend } from "@/components/CohortLegend";
import { PUBLIC_COHORTS } from "@/lib/cohort";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  // The episode table fetches its own pages from /api/episodes (server-side
  // sort/search/pagination), so the page no longer ships the whole archive —
  // TTFB stays flat as the episode count grows. Only SystemStats renders here.
  return (
    <main className="min-h-screen">
      <Header activePage="activity" />

      <section className="px-6 pt-10 pb-16 max-w-5xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">
            ← Soapbox Index
          </a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Activity log
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          Receipts, in the open. The scale of what we&apos;ve analyzed, and
          every episode the pipeline has ingested — with exactly how far each
          one made it through transcription, issue classification, and
          sentiment scoring. Sort, search, and page through the full record.
        </p>

        {/* System scale */}
        <div className="mt-8">
          <SystemStats />
        </div>

        {/* Episode receipts — sortable / searchable table */}
        <div className="mt-10">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
              Episode receipts
            </h2>
            {PUBLIC_COHORTS.length > 1 && <CohortLegend />}
          </div>
          <EpisodeDataTable serverSide />
        </div>
      </section>

      <Footer />
    </main>
  );
}
