import { Play } from "lucide-react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timestampedSourceUrl, formatTimestamp } from "@/lib/transcript-timing";
import { cookies } from "next/headers";
import { ReceiptsSection } from "./ReceiptsSection";
import { ReportGate } from "./ReportGate";
import receiptsData from "./receipts.json";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Did CBS News tilt toward Trump under Bari Weiss? | Soapbox Report",
  description:
    "A transcript-based fact-check of the widely-asserted claim that CBS News broadcasts turned pro-Trump after Bari Weiss took over. We measured CBS against ABC, NBC, and PBS on the same stories. The tape mostly does not show it.",
};

/* ------------------------------------------------------------------ data --- */
// Post-Weiss CBS-minus-peer-average administration-favorability, by topic.
// Model-scored, directional only (see methodology note). Positive = CBS framed
// the administration MORE favorably than its peers; negative = more critical.
const GAPS: { topic: string; gap: number; note?: string }[] = [
  { topic: "Venezuela / Maduro operation", gap: 0.69, note: "dissolves on inspection - see below" },
  { topic: "Ukraine", gap: 0.12 },
  { topic: "Immigration / ICE", gap: -0.44 },
  { topic: "China", gap: -0.45 },
  { topic: "Tariffs", gap: -0.63 },
  { topic: "Iran", gap: -0.70 },
];
const MAX_GAP = 1.0;

type Receipt = {
  network: string;
  date: string;
  title: string;
  quote: string;
  score: number;
  kind: "favorable" | "critical" | "artifact";
  href: string;
  startTs?: number;
};

const VENEZUELA: Receipt[] = [
  {
    network: "CBS", date: "Jan 6, 2026", title: "Inside the covert U.S. arrest operation that took Maduro",
    quote: "We are learning more about the U.S. mission to capture Maduro and his wife early Saturday, how it all played out, and with no loss of American life.",
    score: 2.5, kind: "favorable", href: "https://www.youtube.com/watch?v=4dybRZyHBmI",
  },
  {
    network: "CBS", date: "Jan 6, 2026", title: "Maduro defiant in court as new details emerge",
    quote: "...the U.S. is now in charge, a country of 31 million people and its vast oil reserves.",
    score: -2.0, kind: "critical", href: "https://www.youtube.com/watch?v=hl5s-X8VdG8",
  },
  {
    network: "CBS", date: "Jan 7, 2026", title: "Full interview: Maria Corina Machado on Maduro and Venezuela",
    quote: "...because he is upset, he's hurt, that you accepted the Nobel Peace Prize, a prize that he wants for himself.",
    score: 3.5, kind: "artifact", href: "https://www.youtube.com/watch?v=UaQ76SUmZss", startTs: 318,
  },
];

const IMMIGRATION: Receipt[] = [
  {
    network: "CBS", date: "Feb 2026", title: "Trump refuses to apologize for racist video despite outrage",
    quote: "The president, who spoke about his latest actions last night, refused to apologize despite sparking widespread outrage and bipartisan condemnation.",
    score: -3.5, kind: "critical", href: "https://www.youtube.com/watch?v=Mbp15eneEb0", startTs: 4,
  },
  {
    network: "CBS", date: "Feb 2026", title: "14-year-old says she was zip-tied during Idaho immigration raid",
    quote: "With her hands bound behind her back, Romero says she was unable to console her daughter. 'I can't hug her.'",
    score: -4.0, kind: "critical", href: "https://www.youtube.com/watch?v=bRqXAn5ImBA", startTs: 152,
  },
  {
    network: "CBS", date: "Feb 2026", title: "DHS shutdown begins with no deal in sight",
    quote: "A big part of the federal government has ground to a halt in a dispute over the Trump administration's immigration crackdown.",
    score: -2.5, kind: "critical", href: "https://www.youtube.com/watch?v=DoDwYUx6LEM",
  },
];

const TIMELINE: { date: string; event: string }[] = [
  { date: "Apr 22, 2025", event: "60 Minutes executive producer Bill Owens resigns, citing lost editorial independence." },
  { date: "Jul 2025", event: "Paramount settles Trump's lawsuit over a 2024 60 Minutes interview edit (about $16M)." },
  { date: "Aug 7, 2025", event: "Skydance-Paramount merger closes; David Ellison takes over." },
  { date: "Oct 6, 2025", event: "Bari Weiss named editor-in-chief of CBS News, reporting directly to Ellison." },
  { date: "Dec 2025", event: "A 60 Minutes segment on a Venezuelan-deportee prison is pulled (aired Jan 18, 2026)." },
  { date: "Jan 5, 2026", event: "Tony Dokoupil's first CBS Evening News broadcast; his script was reportedly rewritten on the Venezuela operation." },
  { date: "May 28, 2026", event: "Veteran 60 Minutes EP Tanya Simon replaced by Nick Bilton." },
  { date: "Jun 2026", event: "60 Minutes correspondent Scott Pelley fired; he alleged pressure to soften a story." },
];

/* ------------------------------------------------------------ components --- */
function GapRow({ topic, gap, note }: { topic: string; gap: number; note?: string }) {
  const widthPct = (Math.abs(gap) / MAX_GAP) * 100;
  const favorable = gap > 0;
  return (
    <div className="grid grid-cols-[1.4fr_2fr_auto] items-center gap-3 py-1.5">
      <div className="text-sm text-foreground text-right">
        {topic}
        {note && <span className="block text-xs text-ink-faint italic">{note}</span>}
      </div>
      <div className="relative h-5">
        <div className="absolute inset-y-0 left-1/2 w-px bg-input" aria-hidden />
        {favorable ? (
          <div className="absolute top-0.5 bottom-0.5 bg-red-500/80 rounded-r" style={{ left: "50%", width: `${widthPct / 2}%` }} />
        ) : (
          <div className="absolute top-0.5 bottom-0.5 bg-blue-500/80 rounded-l" style={{ right: "50%", width: `${widthPct / 2}%` }} />
        )}
      </div>
      <div className={`text-xs font-semibold tabular-nums min-w-[3.5rem] ${favorable ? "text-red-600" : "text-blue-600"}`}>
        {favorable ? "more favorable" : "more critical"}
      </div>
    </div>
  );
}

function ReceiptCard({ r }: { r: Receipt }) {
  const tone =
    r.kind === "favorable" ? "border-red-200" : r.kind === "critical" ? "border-blue-200" : "border-amber-200";
  const label =
    r.kind === "favorable" ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100">favorable framing</Badge>
    : r.kind === "critical" ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">critical framing</Badge>
    : <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">guest words / mis-scored</Badge>;
  return (
    <Card className={`p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-ink-strong">{r.network} <span className="text-ink-faint font-normal">· {r.date}</span></span>
        {label}
      </div>
      <blockquote className="text-sm text-ink-body leading-relaxed">&ldquo;{r.quote}&rdquo;</blockquote>
      <div className="mt-2 flex items-center justify-between text-xs gap-2">
        <a
          href={timestampedSourceUrl(r.href, r.startTs ?? null)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-ink-muted hover:text-foreground min-w-0"
          title="Watch the source"
        >
          {r.startTs != null && r.startTs > 0 && <Play className="w-2.5 h-2.5 shrink-0" />}
          <span className="underline truncate">{r.title}</span>
          {r.startTs != null && r.startTs > 0 && (
            <span className="tabular-nums shrink-0">{formatTimestamp(r.startTs)}</span>
          )}
        </a>
        <span className="tabular-nums text-ink-faint shrink-0">model score {r.score > 0 ? "+" : ""}{r.score.toFixed(1)}</span>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- page ---- */
export default function CbsBariWeissReport() {
  const totalReceipts = receiptsData.stories.reduce(
    (n, s) => n + s.networks.reduce((m, x) => m + x.receipts.length, 0),
    0,
  );
  const unlocked = cookies().get("sb_unlocked")?.value === "1";
  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-10 pb-16 max-w-3xl mx-auto">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Soapbox Report &middot; June 2026</p>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-2">
          Did CBS News tilt toward Trump under Bari Weiss? We checked the tape.
        </h1>
        <p className="text-ink-muted mt-4 leading-relaxed text-lg">
          Since Bari Weiss became editor-in-chief of CBS News, critics have said its broadcasts turned
          favorable to the Trump administration. It is an editorial claim almost no one has tested with
          data. So we measured how CBS framed the administration against ABC, NBC, and PBS, on the same
          stories, from the broadcast transcripts. Mostly, the tape does not show it.
        </p>

        <Card className="mt-8 p-5 bg-subtle border-border">
          <p className="text-sm font-semibold text-ink-strong">The finding</p>
          <p className="text-ink-body mt-2 leading-relaxed">
            Across major stories spanning Weiss&apos;s arrival, CBS&apos;s on-air framing of the administration
            tracked its peer networks, and on most topics CBS was, if anything, <strong>more critical</strong>
            than ABC, NBC, and PBS, not less. The one story that looked like a smoking gun, the Venezuela
            operation, dissolves on close inspection. This does not prove nothing changed inside CBS. It
            shows that the shift critics describe is not visible in what CBS actually aired.
          </p>
        </Card>

        <h2 className="text-xl font-semibold mt-12">What we measured</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          For each major news story, we pulled the clips CBS, ABC, NBC, and PBS posted in the same window,
          fetched the transcripts, and scored how favorably each network framed the Trump administration&apos;s
          actions. Comparing the same story across networks cancels out the news cycle: if every network is
          covering the same event, the difference between them is editorial. The chart below shows where CBS
          landed relative to the average of its three peers in the post-Weiss period.
        </p>

        <Card className="mt-6 p-5">
          <div className="flex items-center justify-between text-xs text-ink-faint mb-3">
            <span className="text-blue-600 font-semibold">&larr; CBS more critical of admin</span>
            <span className="text-red-600 font-semibold">CBS more favorable to admin &rarr;</span>
          </div>
          <div className="divide-y divide-border">
            {GAPS.map((g) => <GapRow key={g.topic} {...g} />)}
          </div>
          <p className="text-xs text-ink-faint mt-3 leading-relaxed">
            Directional, model-scored. Read the pattern, not the digits: the per-quote scores are produced
            by a language model and carry noise (the Venezuela case below shows exactly how much), so we do
            not lean on the precise magnitudes. What is robust is the direction, on four of six topics CBS
            was more critical of the administration than its peers.
          </p>
        </Card>

        {unlocked ? (
        <>
        <h2 className="text-xl font-semibold mt-12">The one story that looked like a smoking gun</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          On the U.S. operation that captured Venezuela&apos;s Nicolas Maduro in January 2026, the story
          behind a reported rewrite of anchor Tony Dokoupil&apos;s script, our aggregate score put CBS as the
          only one of the four networks that was net-favorable to the administration. That is the result a
          critic would want. So we read every CBS clip, line by line. It does not hold up.
        </p>
        <div className="mt-5 grid gap-3">
          {VENEZUELA.map((r) => <ReceiptCard key={r.title} r={r} />)}
        </div>
        <p className="text-ink-body mt-4 leading-relaxed">
          CBS did air one genuinely favorable line (the operation &ldquo;with no loss of American life&rdquo;),
          but it also aired pointedly critical framing (the U.S. &ldquo;now in charge&rdquo; of a country
          &ldquo;and its vast oil reserves&rdquo;). The high &ldquo;favorable&rdquo; scores that drove CBS&apos;s
          lead came almost entirely from an interview with the Venezuelan <em>opposition</em> leader, her
          words, not CBS&apos;s, and at least one was a plain scoring error: a line describing Trump as jealous
          over the Nobel Peace Prize was scored as <em>favorable</em> to him. Strip the guest interview and
          the error, and CBS&apos;s Venezuela coverage is mixed and roughly neutral, indistinguishable from its
          peers. The apparent tilt was an artifact of the measurement, which is precisely why we read the
          receipts.
        </p>

        <h2 className="text-xl font-semibold mt-12">What CBS actually sounded like</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          Well into the Weiss era, CBS&apos;s coverage of the administration&apos;s signature issue, immigration,
          was tough. These are CBS&apos;s own anchors and correspondents, in February 2026:
        </p>
        <div className="mt-5 grid gap-3">
          {IMMIGRATION.map((r) => <ReceiptCard key={r.title} r={r} />)}
        </div>

        <h2 className="text-xl font-semibold mt-12">Browse the receipts</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          The deep-dives above are hand-checked. But the case does not rest on a few quotes, it rests on
          volume. Below are {totalReceipts} scored mentions of the administration from all four networks
          across five major topics, each with a play button that opens the source video at that exact
          moment. Browse them and judge for yourself. The pattern is plain: on every topic, CBS sits among
          the most critical of the administration, not the most favorable.
        </p>
        <ReceiptsSection stories={receiptsData.stories} />
        <p className="text-xs text-ink-faint mt-3 leading-relaxed">
          Favorability is the model&apos;s &minus;5 (critical) to +5 (favorable) read of each mention&apos;s
          stance toward the administration; intensity is its 1&ndash;5 conviction. Quotes are verbatim
          excerpts, never full transcripts; click the timestamp to verify in context. Individual scores
          carry noise; the value is the volume and the links.
        </p>

        <h2 className="text-xl font-semibold mt-12">What this does, and does not, show</h2>
        <ul className="list-disc pl-6 mt-3 space-y-2 text-ink-body leading-relaxed">
          <li>
            <strong>It measures what aired, not what didn&apos;t.</strong> A transcript cannot see a segment that
            was spiked, a guest who was not booked, or an interview that was softened in the edit. The most
            serious accusations against CBS, a pulled 60 Minutes segment, the firing of Scott Pelley, are
            about exactly those invisible decisions. We take no position on them; they are outside what a
            transcript can adjudicate.
          </li>
          <li>
            <strong>We do not claim CBS &ldquo;did not change.&rdquo;</strong> We report what the tape shows: no
            broad, on-air favorability shift relative to peers. A before-and-after measure exists but swings
            with the choice of window (favorability tracks which events aired), so we do not lean on it.
          </li>
          <li>
            <strong>The scores are a tool, not a verdict.</strong> As the Venezuela case shows, individual
            model scores carry attribution and valence errors. The evidence here is the receipts, the actual
            lines that aired, with their sources, not any single number.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-12">Timeline</h2>
        <div className="mt-4 border-l-2 border-border pl-5 space-y-3">
          {TIMELINE.map((t) => (
            <div key={t.date} className="relative">
              <span className="absolute -left-[1.45rem] top-1.5 h-2 w-2 rounded-full bg-input" aria-hidden />
              <p className="text-sm text-ink-body leading-relaxed">
                <span className="font-semibold text-ink-strong tabular-nums">{t.date}.</span> {t.event}
              </p>
            </div>
          ))}
        </div>

        <h2 className="text-xl font-semibold mt-12">How we measured this</h2>
        <p className="text-ink-body mt-3 leading-relaxed">
          We used the YouTube Search API to find each network&apos;s clips on a given story and window,
          pulled native captions, identified mentions of the administration and its officials, and scored
          each on favorability toward the administration with a language model, the same scoring approach
          described on our <a href="/methodology" className="underline hover:text-foreground">methodology page</a>.
          Networks compared: CBS News, ABC News, NBC News, PBS NewsHour. We publish excerpts and source
          links, never full transcripts. Per-quote scores are model-produced and noisy; treat them as
          directional and read the cited clips.
        </p>

        <p className="text-ink-muted mt-12 text-sm leading-relaxed border-t border-border pt-6">
          Soapbox quantifies what political media is saying, with receipts. This report is a one-time
          analysis, not a live index. Questions or corrections:{" "}
          <a href="/" className="underline hover:text-foreground">soapbox.media</a>.
        </p>
        </>
        ) : (
          <ReportGate reportSlug="cbs-bari-weiss" />
        )}
      </section>
      <Footer />
    </main>
  );
}
