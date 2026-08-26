/**
 * Advertisers: pure detection + canonicalization helpers. No DB and no LLM
 * here (see src/lib/pipeline.ts detectAdCandidates for the driver and
 * src/modules/ads for the Haiku confirm pass) - the same "pure + unit-tested"
 * split as figures.ts / transcript-timing.ts.
 *
 * Two-layer design, validated by scripts/probe-ad-detection.ts (2026-08-25,
 * 300 transcripts): a free regex anchor pass at 94% precision / ~12% missed-ad
 * rate feeds a Haiku confirm that settles the verdict and the brand. The scope
 * is HOST-READ sponsor messages: produced/dynamically-inserted spots carry no
 * sponsor-read language and are intentionally out of scope (a host read is an
 * editorial act; a programmatic insert is not).
 */

import { startTsBefore } from "./figures";

// Strong anchors: essentially never appear outside a sponsor read.
const STRONG_ANCHORS: RegExp[] = [
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
// Weak anchors: common in sponsor reads but appear organically too. A segment
// needs two of these (or one strong) to qualify.
const WEAK_ANCHORS: RegExp[] = [
  /\b\d{1,3}% off\b/i,
  /\bfree (trial|shipping|sample|gift)\b/i,
  /\blink in (the )?description\b/i,
  /\bterms (and conditions )?apply\b/i,
  /\bfor a limited time\b/i,
  /\bmoney[- ]back guarantee\b/i,
  /\b[a-z0-9-]{3,30} dot com\b/i,
  /\bfirst (month|order|box) (is )?free\b/i,
];

/** Anchor hits closer than this collapse into one segment. */
const MERGE_CHARS = 700;
/** Rough speech rate for the duration estimate (~150 wpm). */
const CHARS_PER_SEC = 16;
/** Context taken around the anchor span for the stored excerpt. */
const EXCERPT_BEFORE = 250;
const EXCERPT_AFTER = 450;

export interface AdCandidate {
  charStart: number;
  charEnd: number;
  excerpt: string;
  strongHits: number;
  weakHits: number;
  startTs: number | null;
  estSeconds: number;
}

/** Strip caption timestamps, speaker tags, and sound markers for a clean,
 *  human-readable excerpt (podcast transcripts embed all three inline). */
export function cleanAdExcerpt(s: string): string {
  return s
    .replace(/\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*-->\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?\]/g, " ")
    .replace(/\[SPEAKER_\d+\]/gi, " ")
    .replace(/\[(music|applause|laughter)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect candidate sponsor-read segments in a transcript. Pure and free:
 * anchor regexes scored strong/weak, nearby hits merged into one segment, a
 * segment qualifying with >=1 strong or >=2 weak anchors. The Haiku confirm
 * pass (src/modules/ads) is the precision layer on top.
 */
export function detectAdCandidates(text: string): AdCandidate[] {
  const hits: Array<{ at: number; strong: boolean }> = [];
  for (const re of STRONG_ANCHORS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) hits.push({ at: m.index ?? 0, strong: true });
  }
  for (const re of WEAK_ANCHORS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) hits.push({ at: m.index ?? 0, strong: false });
  }
  hits.sort((a, b) => a.at - b.at);

  const spans: Array<{ start: number; end: number; strong: number; weak: number }> = [];
  for (const h of hits) {
    const last = spans[spans.length - 1];
    if (last && h.at - last.end <= MERGE_CHARS) {
      last.end = h.at;
      if (h.strong) last.strong++;
      else last.weak++;
    } else {
      spans.push({ start: h.at, end: h.at, strong: h.strong ? 1 : 0, weak: h.strong ? 0 : 1 });
    }
  }

  const out: AdCandidate[] = [];
  for (const s of spans) {
    if (s.strong < 1 && s.weak < 2) continue;
    const from = Math.max(0, s.start - EXCERPT_BEFORE);
    const to = Math.min(text.length, s.end + EXCERPT_AFTER);
    const excerpt = cleanAdExcerpt(text.slice(from, to));
    if (excerpt.length < 40) continue;
    out.push({
      charStart: s.start,
      charEnd: s.end,
      excerpt,
      strongHits: s.strong,
      weakHits: s.weak,
      startTs: startTsBefore(text, s.start),
      estSeconds: Math.round(excerpt.length / CHARS_PER_SEC),
    });
  }
  return out;
}

// ─── Advertiser canonicalization ─────────────────────────────────────────
//
// The probe's raw output counted "Quince", "quince.com", and
// "q-u-i-n-c-e.com" (the host spelling the URL out) as three advertisers.
// Everything the confirm pass returns funnels through canonicalAdvertiser()
// so each brand lands on one stable slug.

/** Seed of known podcast sponsors whose display names shouldn't depend on
 *  which alias the model happened to emit. Keyed by canonical slug. */
const KNOWN_BRANDS: Record<string, string> = {
  betterhelp: "BetterHelp",
  ag1: "AG1",
  athleticgreens: "AG1",
  expressvpn: "ExpressVPN",
  nordvpn: "NordVPN",
  squarespace: "Squarespace",
  shopify: "Shopify",
  rocketmoney: "Rocket Money",
  helixsleep: "Helix Sleep",
  prizepicks: "PrizePicks",
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  patriotmobile: "Patriot Mobile",
  mypillow: "MyPillow",
  birchgold: "Birch Gold",
  goldco: "Goldco",
  ziprecruiter: "ZipRecruiter",
  hellofresh: "HelloFresh",
  groundnews: "Ground News",
  deleteme: "DeleteMe",
  incogni: "Incogni",
  simplisafe: "SimpliSafe",
  policygenius: "PolicyGenius",
  preborn: "Preborn",
  hillsdale: "Hillsdale College",
  hillsdalecollege: "Hillsdale College",
  cozyearth: "Cozy Earth",
  fieldofgreens: "Field of Greens",
  hometitlelock: "Home Title Lock",
  relieffactor: "Relief Factor",
  balanceofnature: "Balance of Nature",
  webull: "Webull",
  masterworks: "Masterworks",
  acorns: "Acorns",
  liquidiv: "Liquid IV",
  eightsleep: "Eight Sleep",
  whoop: "WHOOP",
  seatgeek: "SeatGeek",
  mintmobile: "Mint Mobile",
  brooklinen: "Brooklinen",
  quince: "Quince",
  zbiotics: "ZBiotics",
  mauinui: "Maui Nui",
  farmersdog: "The Farmer's Dog",
  nutrafol: "Nutrafol",
  hims: "Hims & Hers",
  himshers: "Hims & Hers",
  himsandhers: "Hims & Hers",
  moink: "Moink",
  goodranchers: "Good Ranchers",
  jasemedical: "Jase Medical",
  blinkist: "Blinkist",
  ridgewallet: "Ridge",
  ridge: "Ridge",
  manscaped: "Manscaped",
  surfshark: "Surfshark",
  audible: "Audible",
  factor: "Factor",
  stampscom: "Stamps.com",
  stamps: "Stamps.com",
  learcapital: "Lear Capital",
  advantagegold: "Advantage Gold",
  americanfinancing: "American Financing",
  odoo: "Odoo",
  ethos: "Ethos",
  aura: "Aura",
};

/** Platform / self-serve domains that show up in sponsor URLs but are never
 *  the advertiser themselves. */
const DOMAIN_STOPLIST = new Set([
  "youtube", "youtu", "twitter", "x", "facebook", "instagram", "tiktok",
  "spotify", "apple", "patreon", "substack", "rumble", "locals", "discord",
  "reddit", "google", "amazon", "twitch", "linktr", "bit", "gmail",
]);

/** Collapse letter-by-letter spellings: "q-u-i-n-c-e" / "q u i n c e" ->
 *  "quince". Only sequences of 3+ single letters with a uniform separator. */
export function despellLetters(s: string): string {
  return s.replace(/\b([a-z](?:[-. ][a-z]){2,})\b/gi, (m) => m.replace(/[-. ]/g, ""));
}

function slugify(s: string): string {
  return despellLetters(s.toLowerCase())
    .replace(/\bthe\s+/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

/** Normalize a spoken/transcribed domain: spelled letters, "dot com", paths,
 *  protocol, www. Returns the bare "stem.tld" or null. */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = despellLetters(raw.toLowerCase().trim())
    .replace(/\s+dot\s+(com|org|co|net|io)\b/g, ".$1")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  d = d.split(/[/\s?#]/)[0];
  const m = d.match(/^([a-z0-9-]{2,40})\.(com|org|co|net|io)$/);
  if (!m) return null;
  if (DOMAIN_STOPLIST.has(m[1])) return null;
  return `${m[1]}.${m[2]}`;
}

export interface CanonicalAdvertiser {
  slug: string;
  name: string;
  domain: string | null;
}

/**
 * Resolve the confirm pass's raw (brand, domain) to one canonical advertiser.
 * Brand string wins for display; the domain stem is the fallback identity.
 * Returns null when neither survives normalization (the segment stays an
 * anonymous confirmed ad rather than polluting the advertiser board).
 */
export function canonicalAdvertiser(
  brandRaw: string | null | undefined,
  domainRaw: string | null | undefined,
): CanonicalAdvertiser | null {
  const domain = normalizeDomain(domainRaw) ?? normalizeDomain(brandRaw);
  const brand = (brandRaw ?? "").replace(/\.(com|org|co|net|io)$/i, "").trim();

  const brandSlug = brand ? slugify(brand) : "";
  const domainSlug = domain ? slugify(domain.split(".")[0]) : "";

  // Prefer whichever form hits the known-brand seed, then the brand string.
  const slug =
    (brandSlug && KNOWN_BRANDS[brandSlug] ? brandSlug : "") ||
    (domainSlug && KNOWN_BRANDS[domainSlug] ? domainSlug : "") ||
    brandSlug ||
    domainSlug;
  if (!slug || slug.length < 2) return null;

  const name =
    KNOWN_BRANDS[slug] ||
    (brand ? brand : domain ? capitalize(domain.split(".")[0]) : slug);
  return { slug, name, domain };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
