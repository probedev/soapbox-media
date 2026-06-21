import type { Metadata } from "next";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { SubscribeButton } from "@/components/SubscribeButton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Soapbox for AI Agents - MCP Server",
  description:
    "Connect your AI agent to Soapbox's political-media dataset: issue mentions, sentiment scores, and trend data from high-reach podcasts and YouTube shows, queryable over MCP.",
};

const EXAMPLE_QUERIES: { who: string; ask: string }[] = [
  {
    who: "Media buyer",
    ask: "Build me a list of right-leaning podcasts under 1M reach whose tariff coverage softened in the last 30 days. Rank by audience and pull the quotes that show the shift.",
  },
  {
    who: "Campaign manager",
    ask: "What moved this week that we should be ready to answer on Sunday? Give me the three biggest swings with the sharpest quote from each side, with links.",
  },
  {
    who: "Comms war room",
    ask: "Every quote about the shutdown fight with sentiment −3 or colder this week, formatted as a morning clips memo with source links.",
  },
  {
    who: "Political consultant",
    ask: "Compare how independent and legacy media framed crime over the last 90 days. Where do the two curves diverge, and who's driving the divergence?",
  },
  {
    who: "Pollster",
    ask: "Which issues surged in mention volume in the last two weeks before showing up anywhere else? Plot the volume curves for the top five and tell me who lit each fuse.",
  },
  {
    who: "Persuasion strategist",
    ask: "Find middle-rated shows that discuss healthcare with right-aligned framing - those audiences may be movable. Quote the framing so I can hear the register.",
  },
  {
    who: "Ad placement",
    ask: "Which M-lean channels gave the economy the most airtime this month? I want reach-ranked placement targets with each channel's stance profile.",
  },
  {
    who: "Journalist",
    ask: "What is the right talking about this week that the left isn't touching at all - and vice versa? Quotes and sources for both lists.",
  },
];

const TOOLS: { name: string; what: string }[] = [
  { name: "search_mentions", what: "The workhorse. Filtered search over scored issue mentions - verbatim quotes with sentiment (−5 left to +5 right), intensity, channel, episode, and a source link. For most YouTube quotes, a timestamped deep link jumps straight to the moment in the video. Ten filters, paginated." },
  { name: "get_issue_trend", what: "Weekly time series for one issue: mention volume, average sentiment, average intensity. Trajectory questions." },
  { name: "get_index", what: "The Soapbox Index (−10…+10) over any trailing window, with delta, daily sparkline, and top issues by volume." },
  { name: "get_movers", what: "Issues with the biggest period-over-period lean or volume swings, with thin-sample noise filtered out." },
  { name: "get_issue_breakdown", what: "Who is moving one issue, with receipts: each show's signed contribution to the issue's lean, plus a representative supporting quote and source link. Pairs with get_movers to explain a swing." },
  { name: "get_issue_detail", what: "One issue, drilled in: which channels drive it this week and from which side." },
  { name: "get_channel_detail", what: "One show, drilled in: its issue mix and per-issue stance profile, plus (YouTube) typical per-video views vs subscriber reach and the show's runaway over/under-performing videos." },
  { name: "list_issues", what: "The full issue taxonomy with definitions and the canonical left/right positions used in scoring." },
  { name: "list_channels", what: "The tracked panel: every show with lean, cohort (independent vs legacy), platform, and audience reach - plus, for YouTube, typical per-video views and the views-per-subscriber ratio." },
  { name: "get_methodology", what: "How every number is computed, plus live panel statistics - so your agent can cite its sources." },
];

export default function McpPage() {
  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-16 max-w-3xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Soapbox for AI agents
        </h1>
        <p className="text-ink-muted mt-3 leading-relaxed">
          Everything on this site - the Index, the issue trends, the channel stances - is computed
          from a dataset of scored, quoted, source-linked issue mentions across high-reach political
          podcasts and YouTube shows. The charts answer the questions we thought to ask. Your
          questions are different, and there are more of them than any dashboard can hold.
        </p>
        <p className="text-ink-body mt-4 leading-relaxed">
          So we expose the dataset directly to AI agents over{" "}
          <a
            href="https://modelcontextprotocol.io"
            className="underline hover:text-foreground"
            rel="noopener noreferrer"
          >
            MCP
          </a>{" "}
          (Model Context Protocol). Connect Claude, Cursor, or any MCP-capable agent with one
          config block, and ask in plain English. The agent composes the queries; you get answers
          with verbatim quotes and source links.
        </p>

        <div className="mt-6 p-5 border border-input bg-subtle rounded-lg">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">$300</span>
            <span className="text-muted-foreground text-sm">/month · full MCP access</span>
          </div>
          <p className="text-sm text-ink-muted mt-1 mb-3">
            Subscribe and we&apos;ll email you a link to set your password and connect your agent. Cancel anytime.
          </p>
          <SubscribeButton />
        </div>

        <h2 className="text-xl font-semibold mt-12">Who this is for</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Campaign teams deciding what to answer and where. Media buyers placing spots against
          stance, not just demographics. Political consultants and pollsters who want a leading
          indicator on issue salience. Comms shops building clips memos at 6am. Journalists and
          researchers mapping who said what, when, with receipts. If your job involves knowing
          what political media is saying before everyone else does, this is the raw feed.
        </p>

        <h2 className="text-xl font-semibold mt-12">Ask it anything</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          These are real questions the dataset can answer today - each one resolves to a couple of
          tool calls your agent makes on your behalf:
        </p>
        <div className="mt-5 space-y-4">
          {EXAMPLE_QUERIES.map((q) => (
            <div key={q.who} className="border border-border rounded-md p-4">
              <div className="text-xs font-mono uppercase tracking-wide text-ink-faint">{q.who}</div>
              <p className="text-ink-strong mt-1 leading-relaxed">&ldquo;{q.ask}&rdquo;</p>
            </div>
          ))}
        </div>

        <h2 className="text-xl font-semibold mt-12">What&apos;s underneath: ten tools</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Your agent discovers these automatically on connect. Every tool is read-only.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table className="border-collapse">
            <TableBody>
              {TOOLS.map((t) => (
                <TableRow key={t.name} className="border-t border-border align-top hover:bg-transparent">
                  <TableCell className="py-3 pr-4 font-mono text-xs whitespace-nowrap text-ink-strong">{t.name}</TableCell>
                  <TableCell className="py-3 text-ink-body leading-relaxed">{t.what}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <h2 className="text-xl font-semibold mt-12">The data, and its boundaries</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Every mention is a verbatim quote extracted at classification time, scored for sentiment
          (−5 strongly left-aligned to +5 strongly right-aligned) and intensity (1–5), and linked
          to its source episode - for most YouTube mentions, a <code className="text-sm">start_ts</code>{" "}
          (and a <code className="text-sm">timestamp_url</code> deep link) opens the video at the moment
          the quote was said. Aggregates use the same reach- and intensity-weighted math as the
          public site - the full derivation is on the{" "}
          <a href="/methodology" className="underline hover:text-foreground">methodology page</a>,
          and your agent can pull it live via <code className="text-sm">get_methodology</code>.
        </p>
        <p className="text-ink-body mt-4 leading-relaxed">
          One hard boundary: <strong>full transcripts are never exposed</strong> - through this API
          or anywhere else. You get mention-level excerpts and a link to the source episode. This
          is both a licensing obligation to our transcript providers and house policy.
        </p>

        <h2 className="text-xl font-semibold mt-12">Getting connected</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Setup takes about two minutes and needs no coding: subscribe, set a password, and add
          Soapbox as a custom connector in your AI app (Claude, ChatGPT, Cursor, and more). It
          authenticates with a quick browser sign-in - there&apos;s no key to paste. The setup guide
          walks you through every click, with copy-paste configs for developer tools.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href="/connect"
            className="inline-flex items-center justify-center rounded-md bg-primary text-white text-sm font-medium px-5 py-2.5 hover:bg-primary/90 transition"
          >
            Open the setup guide
          </a>
          <span className="text-sm text-ink-muted">$300/month · cancel anytime</span>
        </div>
      </section>

      <Footer />
    </main>
  );
}
