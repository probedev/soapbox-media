import { createServiceClient } from "@/lib/db";
import { SystemStats } from "@/components/SystemStats";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getChannelExternalUrl } from "@/lib/channelLinks";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

function leanBadge(lean: "L" | "M" | "R"): string {
  switch (lean) {
    case "L":
      return "bg-blue-100 text-blue-800";
    case "R":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

interface ChannelRow {
  id: string;
  name: string;
  platform: "youtube" | "podcast";
  platform_id: string;
  political_lean: "L" | "M" | "R";
  reach: number | bigint;
  classification_rationale: string | null;
}

export default async function ChannelsListPage() {
  const db = createServiceClient();
  const { data: channels } = await db
    .from("channels")
    .select("id, name, platform, platform_id, political_lean, reach, classification_rationale")
    .eq("active", true)
    .order("reach", { ascending: false })
    .range(0, 999);

  const rows = (channels || []) as ChannelRow[];
  const byLean = {
    L: rows.filter((c) => c.political_lean === "L"),
    M: rows.filter((c) => c.political_lean === "M"),
    R: rows.filter((c) => c.political_lean === "R"),
  };

  return (
    <main className="min-h-screen">
      <Header activePage="channels" />

      <section className="px-6 pt-10 pb-16 max-w-5xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">← Soapbox Index</a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Channels we track</h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          {rows.length} hand-curated alt-media political channels, balanced across Left, Middle,
          and Right publishing posture. Reach figures are pulled live from the YouTube Data API
          and PodScan; classifications are editorial and reviewed quarterly. See the{" "}
          <a href="/methodology" className="underline hover:text-gray-900">methodology page</a>{" "}
          for selection criteria.
        </p>

        {/* System scale — credibility signal: how much audio + how many mentions we've processed */}
        <div className="mt-8">
          <SystemStats />
        </div>

        {(["L", "M", "R"] as const).map((bucket) => (
          <section key={bucket} className="mt-10">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold">
                {bucket === "L"
                  ? "Left-leaning"
                  : bucket === "R"
                  ? "Right-leaning"
                  : "Middle / cross-cutting"}{" "}
                <span className="text-gray-400 text-sm font-normal">({byLean[bucket].length})</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byLean[bucket].map((c) => {
                const ext = getChannelExternalUrl({
                  platform: c.platform,
                  platform_id: c.platform_id,
                  name: c.name,
                });
                return (
                  <div
                    key={c.id}
                    className="relative border border-gray-200 bg-white rounded-lg hover:border-gray-400 hover:shadow-sm transition group"
                  >
                    <a href={`/channels/${c.id}`} className="block p-4 pr-10">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanBadge(c.political_lean)}`}
                          >
                            {c.political_lean}
                          </span>
                          {c.name}
                        </div>
                        <div className="text-xs text-gray-500 whitespace-nowrap">{c.platform}</div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 tabular-nums">
                        Reach: {Number(c.reach).toLocaleString()}
                      </div>
                      {c.classification_rationale && (
                        <div className="text-xs text-gray-600 mt-2 leading-snug line-clamp-2">
                          {c.classification_rationale}
                        </div>
                      )}
                    </a>
                    <a
                      href={ext.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={ext.label}
                      title={ext.label}
                      className="absolute top-3 right-3 text-gray-400 hover:text-gray-900 p-1.5 opacity-50 group-hover:opacity-100 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </section>

      <Footer />
    </main>
  );
}
