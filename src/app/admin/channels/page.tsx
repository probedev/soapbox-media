import { createServiceClient } from "@/lib/db";
import { AdminNav } from "@/components/AdminNav";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AddChannelClient } from "./AddChannelClient";

export const dynamic = "force-dynamic";
// Server actions (addChannelAction) run YT API + 30 episode upserts; give them
// real headroom rather than the default function timeout.
export const maxDuration = 300;

interface ChannelRow {
  id: string;
  name: string;
  platform: string;
  political_lean: "L" | "M" | "R";
  reach: number;
  active: boolean;
  created_at: string;
}

export default async function AdminChannelsPage() {
  const db = createServiceClient();
  const { data } = await db
    .from("channels")
    .select("id, name, platform, political_lean, reach, active, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  const recent = (data || []) as ChannelRow[];

  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <AdminNav active="channels" />
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Channels</h1>
        <p className="text-gray-600 mt-2 text-sm leading-relaxed max-w-3xl">
          Add a new alt-media channel to the panel. Enter a YouTube handle or
          URL; we resolve it via the YT API, validate the **300K subscriber
          floor**, insert it, and deep-ingest the last 30 episodes so it
          doesn&apos;t start empty. The transcribe → classify → score crons
          pick them up over the next 1–3 days.
        </p>
        <div className="mt-6">
          <AddChannelClient />
        </div>

        <div className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-3">
            20 most recently added
          </h2>
          <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
            {recent.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      c.political_lean === "L"
                        ? "bg-blue-100 text-blue-800"
                        : c.political_lean === "R"
                        ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {c.political_lean}
                  </span>
                  <span className="font-medium truncate">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.platform}</span>
                </div>
                <div className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                  {c.reach.toLocaleString()} · {new Date(c.created_at).toLocaleDateString()}
                  {!c.active && <span className="ml-2 text-red-500">inactive</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
