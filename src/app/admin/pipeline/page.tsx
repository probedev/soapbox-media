import { getRecentUsage } from "@/lib/usage";
import { PipelineHealth } from "@/components/PipelineHealth";
import { AdminNav } from "@/components/AdminNav";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";

export default async function AdminPipelinePage() {
  const runs = await getRecentUsage(30);

  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <AdminNav active="pipeline" />
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Pipeline health
        </h1>
        <p className="text-gray-600 mt-2 text-sm leading-relaxed max-w-3xl">
          Per-stage health of the daily cron and recent run detail. Internal
          view — the public /log page shows scale and episode receipts only.
        </p>
        <div className="mt-6">
          <PipelineHealth runs={runs} />
        </div>
      </section>
      <Footer />
    </main>
  );
}
