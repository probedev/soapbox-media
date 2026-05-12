import { getRecentEpisodes } from "@/lib/episodes";
import { EpisodeList } from "@/components/EpisodeList";
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
  const { episodes, total } = await getRecentEpisodes({
    limit: PAGE_SIZE,
    offset,
  });
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
          Activity log
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          Receipts. Every episode the soapbox pipeline has ingested, ordered by
          publish date. Status badges show whether the transcript has been
          fetched, is still pending, or failed. Click any episode to open the
          source on YouTube or the podcast host.
        </p>

        <div className="text-xs text-gray-500 mt-6 tabular-nums">
          Showing episodes {start.toLocaleString()}–{end.toLocaleString()} of{" "}
          {total.toLocaleString()}
        </div>

        <div className="mt-3">
          <EpisodeList episodes={episodes} showChannel emptyMessage="No episodes ingested yet." />
        </div>

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
      </section>

      <Footer />
    </main>
  );
}
