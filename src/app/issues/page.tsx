import { createServiceClient } from "@/lib/db";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  IssueActivityByTopic,
  type TopicActivityRow,
} from "@/components/IssueActivityByTopic";
import { getDashboardData, readHomeSnapshot, type IssueAggregate } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

const ACTIVITY_WINDOW_DAYS = 7;
/** Display label for the unbucketed ("Other") topic group in the activity card. */
const UNBUCKETED_TOPIC_LABEL = "Political figures & parties";

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
      name: "Political figures & parties",
      description: "Leaders and party institutions, tracked as their own issues.",
      issues: orphaned,
    });
  }

  // Activity rollup: read per-issue volume/lean from the precomputed home
  // snapshot (fast - one row, no heavy join), fall back to a live compute only
  // if the snapshot is missing. Then aggregate to the same topic groups the
  // list uses below: mentions = Σ raw classification count, lean = volume-
  // weighted so the tint matches the Index basis.
  const snapshot = await readHomeSnapshot(ACTIVITY_WINDOW_DAYS).catch(() => null);
  const issueStats: IssueAggregate[] =
    snapshot?.dashboard.issues ??
    (await getDashboardData(ACTIVITY_WINDOW_DAYS).then((d) => d.issues).catch(() => []));
  const statsBySlug = new Map(issueStats.map((s) => [s.slug, s]));

  const topicActivity: TopicActivityRow[] = sections
    .map((s) => {
      let mentions = 0;
      let leanWeightSum = 0;
      let volume = 0;
      for (const issue of s.issues) {
        const stat = statsBySlug.get(issue.slug);
        if (!stat) continue;
        mentions += stat.numClassifications;
        volume += stat.volume;
        leanWeightSum += stat.lean * stat.volume;
      }
      return {
        slug: s.slug,
        name: s.slug ? s.name : UNBUCKETED_TOPIC_LABEL,
        mentions,
        numIssues: s.issues.length,
        lean: volume > 0 ? leanWeightSum / volume : 0,
      };
    })
    .filter((r) => r.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions);
  const totalMentions = topicActivity.reduce((sum, r) => sum + r.mentions, 0);

  return (
    <main className="min-h-screen">
      <Header activePage="issues" />

      <section className="px-6 pt-10 pb-16 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          <a href="/" className="hover:text-ink-body">← Soapbox Index</a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Issue taxonomy</h1>
        <p className="text-ink-muted mt-3 leading-relaxed max-w-3xl">
          The {issues.length} political issues we track across YouTube and podcasts, grouped under{" "}
          {sections.length} topics. Each has an explicit left- and right-leaning position, and every
          mention is scored against those - not US-political stereotypes - then weighted by each
          channel&apos;s audience and capped at 3 episodes a day, so the signal reflects stance per
          audience rather than who posts most often. Click any issue for the channel-level breakdown.
        </p>

        {topicActivity.length > 0 && (
          <div className="mt-8">
            <IssueActivityByTopic
              rows={topicActivity}
              totalMentions={totalMentions}
              windowDays={ACTIVITY_WINDOW_DAYS}
            />
          </div>
        )}

        <div className="mt-10 space-y-10">
          {sections.map((s) => (
            <div key={s.name}>
              <div className="flex items-baseline gap-3 border-b border-border pb-2 mb-4">
                {s.slug ? (
                  <a href={`/topics/${s.slug}`} className="text-lg font-semibold hover:text-ink-muted">
                    {s.name} <span className="text-ink-faint font-normal">→</span>
                  </a>
                ) : (
                  <h2 className="text-lg font-semibold">{s.name}</h2>
                )}
                <span className="text-xs text-muted-foreground">{s.description}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {s.issues.map((i) => (
                  <a
                    key={i.slug}
                    href={`/issues/${i.slug}`}
                    className="block border border-border bg-card rounded-lg p-4 hover:border-ink-faint hover:shadow-sm transition"
                  >
                    <div className="font-medium text-foreground">{i.name}</div>
                    <div className="text-sm text-ink-muted mt-1 leading-snug">{i.definition}</div>
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
