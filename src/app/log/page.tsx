import { getRecentEpisodes } from "@/lib/episodes";
import { getRecentUsage } from "@/lib/usage";
import { EpisodeList } from "@/components/EpisodeList";
import { SystemStats } from "@/components/SystemStats";
import { PipelineHealth } from "@/components/PipelineHealth";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: { page?: string };
}

export default async function LogPage({ searchParams }: PageProps) {
  const page = Math.max(1, parseInt(searchParams.page || "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [{ episodes, total }, runs] = await Promise.all([
    getRecentEpisodes({ limit: PAGE_SIZE, offset }),
    getRecentUsage(30),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-16 max-w-5xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">
            ← Soapbox Index
          </a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Pipeline &amp; activity log
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          Receipts, in the open. The scale of what we&apos;ve analyzed, the
          health of the daily pipeline that runs it, and every episode the
          system has ingested. If a stage breaks, you&apos;ll see it here before
          it quietly distorts the Index.
        </p>

        {/* System scale (credibility) */}
        <div className="mt-8">
          <SystemStats />
        </div>

        {/* Pipeline health (operations + transparency) */}
        <div className="mt-6">
          <PipelineHealth runs={runs} />
        </div>

        {/* Episode receipts */}
        <div className="mt-10">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
              Episode receipts
            </h2>
            <span className="text-xs text-gray-500 tabular-nums">
              {start.toLocaleString()}–{end.toLocaleString()} of{" "}
              {total.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-gray-500 mb-3 max-w-3xl">
            Every episode the pipeline has ingested, newest first. The dots
            track how far each one has moved through the four stages —
            ingested, transcribed, classified, scored. Green is done, red
            failed, amber partial, grey not yet reached. Click any title to
            open the source.
          </p>
          <EpisodeList
            episodes={episodes}
            showChannel
            emptyMessage="No episodes ingested yet."
          />

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between gap-3 text-sm">
              {page > 1 ? (
                <a
                  href={`/log?page=${page - 1}`}
                  className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 transition"
                >
                  ← Previous
                </a>
              ) : (
                <span className="px-3 py-1.5 border border-gray-200 rounded-md text-gray-400">
                  ← Previous
                </span>
              )}
              <span className="text-gray-500 tabular-nums">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <a
                  href={`/log?page=${page + 1}`}
                  className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 transition"
                >
                  Next →
                </a>
              ) : (
                <span className="px-3 py-1.5 border border-gray-200 rounded-md text-gray-400">
                  Next →
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
