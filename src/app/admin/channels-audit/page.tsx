import {
  getChannelAudit,
  getIssueGaps,
  getCandidateVoiceMentions,
  type ChannelAuditRow,
  type IssueGapRow,
  type CandidateVoice,
} from "@/lib/audit";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

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

function formatDate(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChannelCadenceTable({ rows }: { rows: ChannelAuditRow[] }) {
  const dormant = rows.filter((r) => r.episodes_14d === 0);
  const active = rows.filter((r) => r.episodes_14d > 0);

  return (
    <>
      <div className="border border-gray-200 rounded-lg bg-white">
        <div className="px-3 py-2 grid grid-cols-[1fr_70px_70px_70px_70px_70px_70px] gap-3 text-[10px] uppercase tracking-wider text-gray-400 bg-gray-50 border-b border-gray-200">
          <div>Channel</div>
          <div className="text-right">Reach</div>
          <div className="text-right">Eps/14d</div>
          <div className="text-right">Last</div>
          <div className="text-right">Class/14d</div>
          <div className="text-right">Issues/14d</div>
          <div className="text-right">Platform</div>
        </div>
        {active.map((c) => (
          <a
            key={c.id}
            href={`/channels/${c.id}`}
            className="px-3 py-2 grid grid-cols-[1fr_70px_70px_70px_70px_70px_70px] gap-3 items-center text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanBadge(c.political_lean)}`}
              >
                {c.political_lean}
              </span>
              <span className="truncate font-medium text-gray-900">{c.name}</span>
            </div>
            <div className="text-right text-xs text-gray-500 tabular-nums">
              {c.reach >= 1_000_000
                ? `${(c.reach / 1_000_000).toFixed(1)}M`
                : c.reach >= 1_000
                ? `${(c.reach / 1_000).toFixed(0)}k`
                : c.reach}
            </div>
            <div className="text-right tabular-nums">{c.episodes_14d}</div>
            <div className="text-right text-xs text-gray-500 tabular-nums">
              {formatDate(c.last_published_at)}
            </div>
            <div className="text-right tabular-nums">{c.classifications_14d}</div>
            <div className="text-right tabular-nums">{c.distinct_issues_14d}</div>
            <div className="text-right text-xs text-gray-500">{c.platform}</div>
          </a>
        ))}
      </div>

      {dormant.length > 0 && (
        <div className="mt-6">
          <div className="text-sm font-semibold text-amber-700 mb-2">
            Dormant ({dormant.length}) — no episodes in last 14 days
          </div>
          <div className="border border-amber-200 rounded-lg bg-amber-50/50 divide-y divide-amber-100">
            {dormant.map((c) => (
              <a
                key={c.id}
                href={`/channels/${c.id}`}
                className="block px-3 py-2 text-sm hover:bg-amber-50 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${leanBadge(c.political_lean)}`}
                  >
                    {c.political_lean}
                  </span>
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="text-xs text-gray-500">({c.platform})</span>
                </div>
                <div className="text-xs text-gray-500 tabular-nums">
                  last: {formatDate(c.last_published_at)}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function IssueGapTable({ rows }: { rows: IssueGapRow[] }) {
  return (
    <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
      <div className="px-3 py-2 grid grid-cols-[1fr_60px_60px_60px_80px] gap-3 text-[10px] uppercase tracking-wider text-gray-400 bg-gray-50">
        <div>Issue</div>
        <div className="text-right">L</div>
        <div className="text-right">M</div>
        <div className="text-right">R</div>
        <div className="text-right">Gap (R - L)</div>
      </div>
      {rows.map((i) => {
        const lLight = i.lean_gap > 5;
        const rLight = i.lean_gap < -5;
        return (
          <a
            key={i.slug}
            href={`/issues/${i.slug}`}
            className="px-3 py-2 grid grid-cols-[1fr_60px_60px_60px_80px] gap-3 items-center text-sm hover:bg-gray-50"
          >
            <div className="font-medium truncate">{i.name}</div>
            <div
              className={`text-right tabular-nums ${lLight ? "text-amber-600 font-semibold" : ""}`}
            >
              {i.l_mentions}
            </div>
            <div className="text-right tabular-nums text-gray-500">{i.m_mentions}</div>
            <div
              className={`text-right tabular-nums ${rLight ? "text-amber-600 font-semibold" : ""}`}
            >
              {i.r_mentions}
            </div>
            <div
              className={`text-right tabular-nums font-semibold ${
                i.lean_gap > 0 ? "text-red-600" : i.lean_gap < 0 ? "text-blue-600" : "text-gray-500"
              }`}
            >
              {i.lean_gap > 0 ? "+" : ""}
              {i.lean_gap}
            </div>
          </a>
        );
      })}
    </div>
  );
}

function VoiceTable({ rows }: { rows: CandidateVoice[] }) {
  const tracked = rows.filter((v) => v.tracked && v.mentions > 0);
  const candidates = rows.filter((v) => !v.tracked && v.mentions > 0);
  const zero = rows.filter((v) => v.mentions === 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Candidates to consider adding ({candidates.length})
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Names appearing in our existing transcripts that we don&apos;t yet track. Higher
          mention count = stronger candidate.
        </p>
        <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
          {candidates.map((v) => (
            <div
              key={v.name}
              className="px-3 py-2 flex items-center justify-between text-sm"
            >
              <span className="font-medium">{v.name}</span>
              <span
                className={`tabular-nums ${
                  v.mentions >= 10 ? "text-amber-700 font-semibold" : "text-gray-500"
                }`}
              >
                {v.mentions}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Tracked, for reference ({tracked.length})
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          How often each currently-tracked voice is referenced in our own transcripts.
          Helps spot most-cited voices in the alt-media conversation.
        </p>
        <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
          {tracked.map((v) => (
            <div
              key={v.name}
              className="px-3 py-2 flex items-center justify-between text-sm"
            >
              <span className="font-medium text-gray-700">{v.name}</span>
              <span className="tabular-nums text-gray-500">{v.mentions}</span>
            </div>
          ))}
        </div>
      </div>

      {zero.length > 0 && (
        <div className="md:col-span-2 text-xs text-gray-500">
          No mentions found for: {zero.map((v) => v.name).join(", ")}.
        </div>
      )}
    </div>
  );
}

export default async function ChannelsAuditPage() {
  const [audit, gaps, voices] = await Promise.all([
    getChannelAudit(),
    getIssueGaps(),
    getCandidateVoiceMentions(),
  ]);

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-16 max-w-6xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">
            ← Soapbox Index
          </a>{" "}
          ·{" "}
          <span className="text-amber-600">Admin</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Channels audit
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          Three views to guide channel curation: publishing cadence (who is
          posting, who has gone dormant), L/M/R coverage gaps by issue
          (which issues need more voices on one side), and a "mentioned but
          not tracked" report (whose name keeps coming up in our own
          transcripts that we should consider adding).
        </p>

        <section className="mt-12">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Publishing cadence</h2>
            <span className="text-xs text-gray-500">last 14 days</span>
          </div>
          <ChannelCadenceTable rows={audit} />
        </section>

        <section className="mt-16">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">L/M/R coverage gaps by issue</h2>
            <span className="text-xs text-gray-500">all time, sorted by |gap|</span>
          </div>
          <p className="text-sm text-gray-600 mb-3 max-w-2xl">
            Mention counts per issue, bucketed by the political lean of the
            channel that produced the mention. A large gap doesn&apos;t
            necessarily indicate a problem (some issues genuinely break one way
            across alt-media), but it does mean we&apos;re measuring with less
            balance on those issues. Highlighted amber values are channels-of-a-lean
            with under-10 mentions where the other side has many more.
          </p>
          <IssueGapTable rows={gaps} />
        </section>

        <section className="mt-16">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Mentioned voices</h2>
            <span className="text-xs text-gray-500">scanning all classification supporting quotes</span>
          </div>
          <p className="text-sm text-gray-600 mb-5 max-w-2xl">
            Curated list of alt-media voices. Counts reflect how often each
            name appears in our own transcript-derived supporting quotes.
            Untracked candidates with high mention counts are strong
            additions; tracked voices give a reference for how much each
            already-tracked figure is referenced.
          </p>
          <VoiceTable rows={voices} />
        </section>
      </section>

      <Footer />
    </main>
  );
}
