import { createServiceClient } from "@/lib/db";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";

interface IssueRow {
  slug: string;
  name: string;
  definition: string;
  left_position: string;
  right_position: string;
  topic_slug: string | null;
}

interface TopicRow {
  slug: string;
  name: string;
  description: string;
  sort_order: number;
}

export default async function IssuesListPage() {
  const db = createServiceClient();
  const [issuesRes, topicsRes] = await Promise.all([
    db
      .from("issues")
      .select("slug, name, definition, left_position, right_position, topic_slug")
      .eq("active", true)
      .order("name"),
    db.from("topics").select("slug, name, description, sort_order").order("sort_order"),
  ]);
  const issues = (issuesRes.data || []) as IssueRow[];
  const topics = (topicsRes.data || []) as TopicRow[];

  const byTopic = new Map<string, IssueRow[]>();
  for (const i of issues) {
    const key = i.topic_slug || "__none";
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key)!.push(i);
  }

  // Topics (in order) that have at least one active issue, then an "Other" group.
  const sections: { slug: string | null; name: string; description: string; issues: IssueRow[] }[] = [];
  for (const t of topics) {
    const group = byTopic.get(t.slug);
    if (group && group.length)
      sections.push({ slug: t.slug, name: t.name, description: t.description, issues: group });
  }
  const orphaned = byTopic.get("__none");
  if (orphaned && orphaned.length) {
    sections.push({
      slug: null,
      name: "Other",
      description: "Political figures & parties (not yet bucketed).",
      issues: orphaned,
    });
  }

  return (
    <main className="min-h-screen">
      <Header activePage="issues" />

      <section className="px-6 pt-10 pb-16 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">← Soapbox Index</a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Issue taxonomy</h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          The {issues.length} political issues we classify alt-media discourse against, grouped
          under {sections.length} broad topics. Each issue has an explicit left- and right-leaning
          position; every sentiment score is measured against those positions, not US-political
          stereotypes. Click any issue for the channel-level breakdown.
        </p>

        <div className="mt-10 space-y-10">
          {sections.map((s) => (
            <div key={s.name}>
              <div className="flex items-baseline gap-3 border-b border-gray-200 pb-2 mb-4">
                {s.slug ? (
                  <a href={`/topics/${s.slug}`} className="text-lg font-semibold hover:text-gray-600">
                    {s.name} <span className="text-gray-400 font-normal">→</span>
                  </a>
                ) : (
                  <h2 className="text-lg font-semibold">{s.name}</h2>
                )}
                <span className="text-xs text-gray-500">{s.description}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {s.issues.map((i) => (
                  <a
                    key={i.slug}
                    href={`/issues/${i.slug}`}
                    className="block border border-gray-200 bg-white rounded-lg p-4 hover:border-gray-400 hover:shadow-sm transition"
                  >
                    <div className="font-medium text-gray-900">{i.name}</div>
                    <div className="text-sm text-gray-600 mt-1 leading-snug">{i.definition}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="text-blue-700">
                        <span className="font-semibold uppercase text-[10px] tracking-wider">L</span>{" "}
                        {i.left_position}
                      </div>
                      <div className="text-red-700">
                        <span className="font-semibold uppercase text-[10px] tracking-wider">R</span>{" "}
                        {i.right_position}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
