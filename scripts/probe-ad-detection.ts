/**
 * READ-ONLY probe: can we detect INLINE ADVERTISEMENTS (sponsor reads) in
 * transcripts - frequency, advertiser identity, and rough duration - well
 * enough to build a market-facing feature on?
 *
 * Method (no writes, ~$0.15 of Haiku for validation only):
 *   1. Pull transcripts of episodes published in the last N days (default 7).
 *   2. Heuristic pass (free): anchor regexes for sponsor language, scored
 *      strong/weak; anchor hits within MERGE_CHARS collapse into one ad
 *      segment; a segment qualifies with >=1 strong or >=2 weak anchors.
 *      Advertiser identity from a domain/"dot com" extraction + a seed
 *      lexicon of known podcast sponsors. Start time via caption segments
 *      (quoteStartSeconds); duration estimated at ~16 transcript chars/sec.
 *   3. LLM validation (Haiku, sampled): 50 flagged segments -> precision;
 *      40 random UNFLAGGED chunks -> missed-ad rate (recall proxy).
 *
 * Run:  npx tsx scripts/probe-ad-detection.ts            (last 7 days)
 *       npx tsx scripts/probe-ad-detection.ts 14 400      (days, max transcripts)
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getAnthropicClient, MODEL_SCORE, extractJson } from "@/lib/anthropic";
import { estimateCostUsd } from "@/lib/pricing";
import { quoteStartSeconds, type TranscriptSegment } from "@/lib/transcript-timing";

const DAYS = parseInt(process.argv[2] || "7", 10);
const MAX_TRANSCRIPTS = parseInt(process.argv[3] || "300", 10);
const MERGE_CHARS = 700; // anchor hits closer than this collapse into one segment
const CHARS_PER_SEC = 16; // ~150 wpm speech

// Strong anchors: essentially never appear outside a sponsor read.
const STRONG: RegExp[] = [
  /this (episode|show|video|podcast) is (sponsored|brought to you|supported|presented) by/i,
  /\b(today'?s|our|episode) sponsors?\b/i,
  /\bsponsored by\b/i,
  /\bbrought to you by\b/i,
  /\bthanks? to [\w .'&-]{2,32} for sponsoring\b/i,
  /\b(promo|coupon|discount) code\b/i,
  /\buse (the )?code\b/i,
  /\bmy code [A-Za-z0-9]{2,20}\b/i,
  /\bgo to [a-z0-9-]{3,30}\.(com|org|co|net|io)\b/i,
  /\b[a-z0-9-]{3,30}\.(com|org|co|net|io)\/[a-z0-9-]{2,24}\b/i,
  /\b[a-z0-9-]{3,30} dot com slash [a-z0-9-]{2,24}\b/i,
];
// Weak anchors: common in sponsor reads but appear organically too - a
// segment needs two of these (or one strong) to qualify.
const WEAK: RegExp[] = [
  /\b\d{1,3}% off\b/i,
  /\bfree (trial|shipping|sample|gift)\b/i,
  /\blink in (the )?description\b/i,
  /\bterms (and conditions )?apply\b/i,
  /\bfor a limited time\b/i,
  /\bmoney[- ]back guarantee\b/i,
  /\b[a-z0-9-]{3,30} dot com\b/i,
  /\bfirst (month|order|box) (is )?free\b/i,
];

// Seed lexicon of podcast sponsors (skewed toward political-media shows).
// Whole-word, case-insensitive. Display name -> match pattern.
const KNOWN_ADVERTISERS: Array<[string, RegExp]> = [
  ["BetterHelp", /\bbetter ?help\b/i],
  ["AG1 / Athletic Greens", /\b(ag ?1|athletic greens)\b/i],
  ["ExpressVPN", /\bexpress ?vpn\b/i],
  ["NordVPN", /\bnord ?vpn\b/i],
  ["Surfshark", /\bsurfshark\b/i],
  ["Squarespace", /\bsquarespace\b/i],
  ["Shopify", /\bshopify\b/i],
  ["Rocket Money", /\brocket money\b/i],
  ["Helix Sleep", /\bhelix (sleep|mattress)\b/i],
  ["PrizePicks", /\bprize ?picks\b/i],
  ["DraftKings", /\bdraft ?kings\b/i],
  ["FanDuel", /\bfan ?duel\b/i],
  ["Patriot Mobile", /\bpatriot mobile\b/i],
  ["MyPillow", /\bmy ?pillow\b/i],
  ["Birch Gold", /\bbirch gold\b/i],
  ["Lear Capital", /\blear capital\b/i],
  ["Goldco", /\bgold ?co\b/i],
  ["Advantage Gold", /\badvantage gold\b/i],
  ["American Financing", /\bamerican financing\b/i],
  ["Balance of Nature", /\bbalance of nature\b/i],
  ["Relief Factor", /\brelief factor\b/i],
  ["ZipRecruiter", /\bzip ?recruiter\b/i],
  ["Stamps.com", /\bstamps ?\.? ?com\b/i],
  ["HelloFresh", /\bhello ?fresh\b/i],
  ["Factor", /\bfactor (meals|75)\b/i],
  ["Audible", /\baudible\b/i],
  ["Ground News", /\bground news\b/i],
  ["DeleteMe", /\bdelete ?me\b/i],
  ["Incogni", /\bincogni\b/i],
  ["Aura", /\baura frames?\b|\baura\.com\b/i],
  ["SimpliSafe", /\bsimpli ?safe\b/i],
  ["PolicyGenius", /\bpolicy ?genius\b/i],
  ["Preborn", /\bpre ?born\b/i],
  ["Hillsdale College", /\bhillsdale\b/i],
  ["Beam", /\bbeam (dream|creatine)\b/i],
  ["Cozy Earth", /\bcozy earth\b/i],
  ["Field of Greens", /\bfield of greens\b/i],
  ["Home Title Lock", /\bhome title lock\b/i],
  ["Tax Network USA", /\btax network usa\b/i],
  ["Done With Debt", /\bdone with debt\b/i],
  ["Webull", /\bwebull\b/i],
  ["Public.com", /\bpublic\.com\b/i],
  ["Masterworks", /\bmasterworks\b/i],
  ["Acorns", /\bacorns\b/i],
  ["Liquid IV", /\bliquid i\.? ?v\b/i],
  ["Armra", /\barmra\b/i],
  ["Eight Sleep", /\beight sleep\b/i],
  ["WHOOP", /\bwhoop\b/i],
  ["SeatGeek", /\bseat ?geek\b/i],
  ["Gametime", /\bgametime\b/i],
  ["Mint Mobile", /\bmint mobile\b/i],
  ["Boll & Branch", /\bboll (and|&) branch\b/i],
  ["Brooklinen", /\bbrooklinen\b/i],
  ["Quince", /\bquince\b/i],
  ["Lumen", /\blumen\b/i],
  ["ZBiotics", /\bz ?biotics\b/i],
  ["Maui Nui", /\bmaui nui\b/i],
  ["The Farmer's Dog", /\bfarmer'?s dog\b/i],
  ["Nutrafol", /\bnutrafol\b/i],
  ["Keeps", /\bkeeps\.com\b/i],
  ["Hims / Hers", /\bhims\b|\bhers\.com\b/i],
  ["Calm", /\bcalm app\b|\bcalm\.com\b/i],
  ["Moink", /\bmoink\b/i],
  ["Good Ranchers", /\bgood ranchers\b/i],
  ["Jase Medical", /\bjase (medical|case)\b/i],
  ["Genucel", /\bgenucel\b/i],
  ["Chalk", /\bchoq\b/i],
  ["Blinkist", /\bblinkist\b/i],
  ["Honey", /\bjoin honey\b|\bhoney\.com\b/i],
  ["Ridge", /\bridge wallet\b/i],
  ["Manscaped", /\bmanscaped\b/i],
];

// Domains that appear in sponsor URLs but are the platform, not the advertiser.
const DOMAIN_STOPLIST = new Set([
  "youtube", "youtu", "twitter", "x", "facebook", "instagram", "tiktok",
  "spotify", "apple", "patreon", "substack", "rumble", "locals", "discord",
  "reddit", "google", "amazon", "twitch", "linktr", "bit", "gmail",
]);

interface AdSegment {
  episodeId: string;
  channelName: string;
  charStart: number;
  charEnd: number;
  strongHits: number;
  weakHits: number;
  advertisers: string[];
  excerpt: string;
  startTs: number | null;
  estSeconds: number;
}

function detectSegments(text: string): Array<{ start: number; end: number; strong: number; weak: number }> {
  const hits: Array<{ at: number; strong: boolean }> = [];
  for (const re of STRONG) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) hits.push({ at: m.index ?? 0, strong: true });
  }
  for (const re of WEAK) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) hits.push({ at: m.index ?? 0, strong: false });
  }
  hits.sort((a, b) => a.at - b.at);
  const segs: Array<{ start: number; end: number; strong: number; weak: number }> = [];
  for (const h of hits) {
    const last = segs[segs.length - 1];
    if (last && h.at - last.end <= MERGE_CHARS) {
      last.end = h.at;
      if (h.strong) last.strong++;
      else last.weak++;
    } else {
      segs.push({ start: h.at, end: h.at, strong: h.strong ? 1 : 0, weak: h.strong ? 0 : 1 });
    }
  }
  return segs.filter((s) => s.strong >= 1 || s.weak >= 2);
}

function extractAdvertisers(excerpt: string): string[] {
  const found = new Set<string>();
  for (const [name, re] of KNOWN_ADVERTISERS) if (re.test(excerpt)) found.add(name);
  // Domain-based extraction: "go to acme.com", "acme.com/ben", "acme dot com"
  const domainRes = [
    /(?:go to|visit|head (?:over )?to|check out|at)\s+([a-z0-9-]{3,30})\.(?:com|org|co|net|io)\b/gi,
    /\b([a-z0-9-]{3,30})\.(?:com|org|co|net|io)\/[a-z0-9-]{2,24}\b/gi,
    /\b([a-z0-9-]{3,30}) dot com\b/gi,
  ];
  for (const re of domainRes) {
    for (const m of excerpt.matchAll(re)) {
      const dom = m[1].toLowerCase();
      if (!DOMAIN_STOPLIST.has(dom) && dom.length >= 3) found.add(`${dom}.com`);
    }
  }
  return [...found];
}

async function llmJudge(
  chunks: Array<{ label: string; text: string }>,
): Promise<{ results: Array<{ label: string; isAd: boolean; advertiser: string | null }>; inTok: number; outTok: number }> {
  const client = getAnthropicClient();
  const results: Array<{ label: string; isAd: boolean; advertiser: string | null }> = [];
  let inTok = 0;
  let outTok = 0;
  const CONC = 8;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONC, chunks.length) }, async () => {
      while (i < chunks.length) {
        const c = chunks[i++];
        try {
          const resp = await client.messages.create({
            model: MODEL_SCORE,
            max_tokens: 150,
            messages: [
              {
                role: "user",
                content: `Below is a chunk of a podcast/YouTube transcript. Does it contain a SPONSOR READ / INLINE ADVERTISEMENT (host reading an ad, promo code, sponsor URL)? Organic product discussion is NOT an ad. Reply with JSON only: {"is_ad": true|false, "advertiser": "<brand name or null>"}\n\n---\n${c.text.slice(0, 2400)}\n---`,
              },
            ],
          });
          inTok += resp.usage?.input_tokens ?? 0;
          outTok += resp.usage?.output_tokens ?? 0;
          const txt = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
          const parsed = extractJson<{ is_ad: boolean; advertiser: string | null }>(txt);
          results.push({ label: c.label, isAd: !!parsed?.is_ad, advertiser: parsed?.advertiser ?? null });
        } catch (e: any) {
          console.error(`  [llm] ${c.label}: ${e?.message || e}`);
        }
      }
    }),
  );
  return { results, inTok, outTok };
}

function pickSpread<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

async function main() {
  const db = createServiceClient();
  const cutoff = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  console.log(`\nAd-detection probe - transcripts from the last ${DAYS}d (cap ${MAX_TRANSCRIPTS})\n`);

  // Pull transcripts (keyset on episode_id; small pages, text is heavy).
  interface TRow { episode_id: string; text: string; segments: TranscriptSegment[] | null; channel: string; durationSec: number | null }
  const transcripts: TRow[] = [];
  let lastId: string | null = null;
  const PAGE = 100;
  while (transcripts.length < MAX_TRANSCRIPTS) {
    let q = db
      .from("transcripts")
      .select("episode_id, text, segments, episodes!inner(published_at, duration_sec, channels(name))")
      .gte("episodes.published_at", cutoff)
      .order("episode_id", { ascending: true })
      .limit(PAGE);
    if (lastId !== null) q = q.gt("episode_id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`transcripts page: ${error.message}`);
    if (!data || data.length === 0) break;
    lastId = String((data[data.length - 1] as any).episode_id);
    for (const t of data as any[]) {
      const ep = Array.isArray(t.episodes) ? t.episodes[0] : t.episodes;
      const ch = ep && (Array.isArray(ep.channels) ? ep.channels[0] : ep.channels);
      if (!t.text) continue;
      transcripts.push({
        episode_id: t.episode_id,
        text: t.text,
        segments: t.segments ?? null,
        channel: ch?.name ?? "?",
        durationSec: ep?.duration_sec ?? null,
      });
      if (transcripts.length >= MAX_TRANSCRIPTS) break;
    }
  }
  console.log(`Loaded ${transcripts.length} transcripts across ${new Set(transcripts.map((t) => t.channel)).size} channels.\n`);

  // Heuristic pass.
  const allSegments: AdSegment[] = [];
  const perChannel = new Map<string, { episodes: number; withAds: number; segments: number; estSeconds: number }>();
  let episodesWithAds = 0;
  for (const t of transcripts) {
    const segs = detectSegments(t.text);
    const chStats = perChannel.get(t.channel) ?? { episodes: 0, withAds: 0, segments: 0, estSeconds: 0 };
    chStats.episodes++;
    if (segs.length > 0) {
      episodesWithAds++;
      chStats.withAds++;
    }
    for (const s of segs) {
      const from = Math.max(0, s.start - 250);
      const to = Math.min(t.text.length, s.end + 450);
      const excerpt = t.text.slice(from, to);
      const estSeconds = Math.round((to - from) / CHARS_PER_SEC);
      const startTs = quoteStartSeconds(t.text.slice(s.start, Math.min(t.text.length, s.start + 120)), t.segments);
      allSegments.push({
        episodeId: t.episode_id,
        channelName: t.channel,
        charStart: from,
        charEnd: to,
        strongHits: s.strong,
        weakHits: s.weak,
        advertisers: extractAdvertisers(excerpt),
        excerpt,
        startTs,
        estSeconds,
      });
      chStats.segments++;
      chStats.estSeconds += estSeconds;
    }
    perChannel.set(t.channel, chStats);
  }

  // ---- Report: heuristic layer ----
  const advCounts = new Map<string, { count: number; channels: Set<string> }>();
  for (const s of allSegments)
    for (const a of s.advertisers) {
      const e = advCounts.get(a) ?? { count: 0, channels: new Set() };
      e.count++;
      e.channels.add(s.channelName);
      advCounts.set(a, e);
    }
  const withIdentity = allSegments.filter((s) => s.advertisers.length > 0).length;
  const withTs = allSegments.filter((s) => s.startTs !== null).length;

  console.log("=".repeat(64));
  console.log("HEURISTIC LAYER");
  console.log("=".repeat(64));
  console.log(`Episodes with >=1 detected ad read: ${episodesWithAds}/${transcripts.length} (${((episodesWithAds / Math.max(1, transcripts.length)) * 100).toFixed(0)}%)`);
  console.log(`Ad segments found: ${allSegments.length} (${(allSegments.length / Math.max(1, transcripts.length)).toFixed(1)}/episode)`);
  console.log(`Segments with an identified advertiser: ${withIdentity}/${allSegments.length} (${((withIdentity / Math.max(1, allSegments.length)) * 100).toFixed(0)}%)`);
  console.log(`Segments with a caption timestamp: ${withTs}/${allSegments.length}`);

  console.log(`\nTop advertisers:`);
  [...advCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 22)
    .forEach(([name, e]) => console.log(`  ${String(e.count).padStart(4)}x  ${name}  (${e.channels.size} channels)`));

  console.log(`\nHighest ad-load channels (>=3 episodes in sample):`);
  [...perChannel.entries()]
    .filter(([, s]) => s.episodes >= 3)
    .sort((a, b) => b[1].segments / b[1].episodes - a[1].segments / a[1].episodes)
    .slice(0, 12)
    .forEach(([name, s]) =>
      console.log(`  ${(s.segments / s.episodes).toFixed(1)} segs/ep · ~${Math.round(s.estSeconds / Math.max(1, s.episodes))}s/ep · ${name} (${s.withAds}/${s.episodes} eps with ads)`),
    );

  console.log(`\nSample detected segments (eyeball check):`);
  for (const s of pickSpread(allSegments, 6)) {
    console.log(`\n--- ${s.channelName} | strong=${s.strongHits} weak=${s.weakHits} | ads: ${s.advertisers.join(", ") || "(unidentified)"} | ts=${s.startTs ?? "?"}s`);
    console.log(`    "${s.excerpt.slice(0, 260).replace(/\s+/g, " ")}..."`);
  }

  // ---- LLM validation ----
  console.log(`\n${"=".repeat(64)}\nLLM VALIDATION (Haiku, sampled)\n${"=".repeat(64)}`);
  const flaggedSample = pickSpread(allSegments, 50).map((s, i) => ({ label: `flagged-${i}`, text: s.excerpt, seg: s }));
  // Unflagged chunks: random 2400-char windows from transcripts, excluding any
  // overlap with detected segments - the recall probe.
  const unflagged: Array<{ label: string; text: string; channel: string }> = [];
  const segsByEp = new Map<string, AdSegment[]>();
  for (const s of allSegments) {
    const arr = segsByEp.get(s.episodeId) ?? [];
    arr.push(s);
    segsByEp.set(s.episodeId, arr);
  }
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (const t of pickSpread(transcripts, 40)) {
    if (t.text.length < 4000) continue;
    for (let tries = 0; tries < 8; tries++) {
      const at = Math.floor(rand() * (t.text.length - 2600));
      const overlaps = (segsByEp.get(t.episode_id) ?? []).some((s) => at < s.charEnd && at + 2400 > s.charStart);
      if (!overlaps) {
        unflagged.push({ label: `unflagged-${unflagged.length}`, text: t.text.slice(at, at + 2400), channel: t.channel });
        break;
      }
    }
    if (unflagged.length >= 40) break;
  }

  const judge = await llmJudge([
    ...flaggedSample.map(({ label, text }) => ({ label, text })),
    ...unflagged.map(({ label, text }) => ({ label, text })),
  ]);

  const flaggedResults = judge.results.filter((r) => r.label.startsWith("flagged-"));
  const flaggedTrue = flaggedResults.filter((r) => r.isAd);
  const unflaggedResults = judge.results.filter((r) => r.label.startsWith("unflagged-"));
  const unflaggedAds = unflaggedResults.filter((r) => r.isAd);

  console.log(`Precision proxy: ${flaggedTrue.length}/${flaggedResults.length} flagged segments confirmed as ads by Haiku (${((flaggedTrue.length / Math.max(1, flaggedResults.length)) * 100).toFixed(0)}%)`);
  console.log(`Recall proxy: ${unflaggedAds.length}/${unflaggedResults.length} random UNFLAGGED chunks contained an ad Haiku found (missed-ad rate ${((unflaggedAds.length / Math.max(1, unflaggedResults.length)) * 100).toFixed(0)}%)`);
  const falsePos = flaggedResults.filter((r) => !r.isAd);
  if (falsePos.length > 0) {
    console.log(`\nHeuristic false positives per Haiku (${falsePos.length}):`);
    for (const fp of falsePos.slice(0, 5)) {
      const seg = flaggedSample.find((f) => f.label === fp.label)?.seg;
      console.log(`  - ${seg?.channelName}: "${seg?.excerpt.slice(0, 140).replace(/\s+/g, " ")}..."`);
    }
  }
  const llmAdvertisers = flaggedTrue.map((r) => r.advertiser).filter(Boolean);
  console.log(`\nHaiku-extracted advertisers on confirmed ads (sample): ${[...new Set(llmAdvertisers)].slice(0, 15).join(", ")}`);
  if (unflaggedAds.length > 0) {
    console.log(`\nAds the heuristics MISSED (per Haiku): ${unflaggedAds.map((r) => r.advertiser || "?").join(", ")}`);
  }

  const cost = estimateCostUsd(MODEL_SCORE, { inputTokens: judge.inTok, outputTokens: judge.outTok });
  console.log(`\nLLM validation cost: $${cost.toFixed(3)} (${judge.inTok} in / ${judge.outTok} out)`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
