import { getDiscoveryCandidates, getActiveIssueOptions, getTopicOptions } from "@/lib/discovery";
import { AdminNav } from "@/components/AdminNav";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DiscoveryClient } from "./DiscoveryClient";

export const dynamic = "force-dynamic";

export default async function AdminDiscoveryPage() {
  const [candidates, issueOptions, topicOptions] = await Promise.all([
    getDiscoveryCandidates("pending"),
    getActiveIssueOptions(),
    getTopicOptions(),
  ]);

  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <AdminNav active="discovery" />
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Issue discovery
        </h1>
        <p className="text-gray-600 mt-2 text-sm leading-relaxed max-w-3xl">
          Emerging political topics the shows are discussing that aren&apos;t in
          the taxonomy yet, clustered from off-taxonomy mentions and ranked by
          reach &times; recency. Promote a candidate into the taxonomy (you write
          the L/R positions), merge it into an existing issue, or ignore it.
          Nothing is added automatically.
        </p>
        <div className="mt-6">
          <DiscoveryClient
            candidates={candidates}
            issueOptions={issueOptions}
            topicOptions={topicOptions}
          />
        </div>
      </section>
      <Footer />
    </main>
  );
}
