/**
 * scripts/discover-socialblade.ts — one-time parse of saved Social Blade
 * "Top Channels by Category" pages.
 *
 * Social Blade is Cloudflare-protected and rejects direct curl/fetch. Save
 * the page from a browser first, then point this script at it. Both raw
 * HTML and Markdown exports (e.g. from a markdown-clipper extension) work:
 *   • `.html` — parse `/youtube/channel/UCxxx` anchors with surrounding text
 *   • `.md`   — parse the table rows (`| [rank] | [![]img name](url) | ...`)
 *
 *   `tsx scripts/discover-socialblade.ts <path1> [path2] …`
 *
 * The parser:
 *   • Extracts handle/channelId + display name + subscriber count.
 *   • Filters to ≥300K subscribers (the panel's sub-floor).
 *   • Cross-references against the existing `channels` table by channelId
 *     (when present), handle, and normalized name.
 *   • Auto-buckets each candidate as ALT-MEDIA / LEGACY / unknown using a
 *     hand-curated keyword list (legacy outlets → `docs/legacy-media-wishlist.md`
 *     for the future cohort; alt-media → `/admin/channels` add-flow).
 *
 * Output is text only; this script never writes to the DB.
 */
import "./_load-env";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createServiceClient } from "@/lib/db";

const SUB_FLOOR = 300_000;

interface Candidate {
  /** YT channel ID (UCxxx) when the source exposes it (HTML form). */
  channelId?: string;
  /** YT handle (no @) when the source uses /youtube/handle/<handle> (markdown form). */
  handle?: string;
  name: string;
  subscribers: number;
  sourceFile: string;
  rank?: number;
}

/**
 * Hand-curated names + substrings of established legacy/MSM outlets.
 * Lowercased. We bucket any candidate whose normalized name contains one of
 * these as LEGACY (parked in the wishlist) vs ALT-MEDIA (potential v1 add).
 *
 * Conservative — only outlets the editor would clearly NOT want in the v1
 * alt-media cohort. Anything unmatched goes to `unknown` for manual review.
 */
const LEGACY_KEYWORDS = [
  "cnn", "abcnews", "abc news", "nbc news", "cbsnews", "cbs news", "msnbc",
  "ms now", "msnow", "fox news", "foxnews", "fox business", "vox",
  "usatoday", "usa today", "wsj", "wall street journal", "bloomberg",
  "businessinsider", "business insider", "associated press", "reuters",
  "bbc", "pbs", "nbcnews", "newshour", "telemundo", "univision", "cnbc",
  "forbes", "newsmax", "the hill", "politico", "the daily wire",
  "inside edition", "nowthis", "noticias", "yahoo news",
  "axios", "the times", "the new york times", "nytimes", "washington post",
  "new york post", "nypost", "the guardian", "al jazeera", "aj+",
  "rt news", "dw news", "france 24", "sky news",
  "abc7", "11alive", "wfaa", "eyewitness", "livenow from fox", "newsnation",
  "el show", "vice news", "rev news", "ap news", "court tv", "courttv",
  "7news", "9news", "kctv", "cbs ", "abc ", "nbc ",
];

/** Substrings that suggest "not a U.S. political-commentary channel". */
const NOT_POLITICAL_KEYWORDS = [
  "dallmyd", "dramaalert", "scarce", "true crime", "code blue", "crime patrol",
  "midwest safety", "shoe0nhead", "clearvalue tax", "new to the street",
  "alofoke", "talk shows central", "el show",
];

/** Substrings that suggest non-US / non-English channels. */
const NON_US_KEYWORDS = [
  "24 news hd", "dbc news", "kantipur", "mizzima", "mubasher", "oneindia",
  "city 42", "news1 tv", "jamuna tv", "mirror now", "om tv", "samacharpati",
  "ebc", "noticias caracol", "primer impacto", "al rojo vivo",
  "rfa ", "voa", "voice of america", "voachinese", "currenttime", "macknack",
  "mekameleen", "zainabsabah", "7news australia", "ajplus", "elias hossain",
];

function isLegacy(name: string): boolean {
  const n = name.toLowerCase();
  return LEGACY_KEYWORDS.some((kw) => n.includes(kw));
}
function isNotPolitical(name: string, handle?: string): boolean {
  const haystack = (name + " " + (handle || "")).toLowerCase();
  return NOT_POLITICAL_KEYWORDS.some((kw) => haystack.includes(kw));
}
function isNonUS(name: string, handle?: string): boolean {
  const haystack = (name + " " + (handle || "")).toLowerCase();
  if (NON_US_KEYWORDS.some((kw) => haystack.includes(kw))) return true;
  // Non-Latin script (Arabic, Cyrillic, Devanagari, Burmese, CJK) — likely non-English.
  return /[Ѐ-ӿ؀-ۿऀ-ॿက-႟　-鿿]/.test(name);
}

/** Turn "10.4M", "892K", "1,234,567" into a number. Returns 0 on failure. */
function parseSubs(raw: string): number {
  const s = raw.trim().replace(/,/g, "").toUpperCase();
  const m = s.match(/^([\d.]+)\s*([KMB]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  const mult = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  return Math.round(n * mult);
}

/**
 * Normalize a channel name for fuzzy compare. Strips the editorial boilerplate
 * ("The X Show" / "X Podcast") that causes Social Blade ↔ panel mismatches:
 *   "Ben Shapiro"           ─┐
 *   "The Ben Shapiro Show"  ─┴→ "benshapiro"
 */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/^the\s+/, "")
    .replace(/\s+(show|podcast)\s*$/, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Parse a Social Blade "Top by category" page.
 * Their row markup historically wraps each entry in a div with class names
 * like `top-list-row` / `ranking-row`; nested anchors point to
 * `/youtube/channel/UCxxxx` and adjacent spans hold the channel name and
 * subscriber count.
 *
 * Rather than depend on exact class names (which they reshuffle), we extract
 * every `/youtube/channel/UCxxx` href and walk a small text window (±400
 * chars) around it to pick out the most-likely name and sub count.
 */
function parseSocialBladeHtml(html: string, sourceFile: string): Candidate[] {
  const candidates: Candidate[] = [];
  const linkRe = /href="\/youtube\/channel\/(UC[\w-]{20,30})"/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const channelId = m[1];
    const start = Math.max(0, m.index - 400);
    const end = Math.min(html.length, m.index + 400);
    const window = html.slice(start, end);

    // The channel name is the visible anchor text. Find it after the href.
    const after = html.slice(m.index, end);
    const nameMatch = after.match(/>([^<]{2,80})<\/a>/);
    const name = nameMatch ? decodeEntities(nameMatch[1]).trim() : "(unknown)";

    // Subscriber count: look for a "K" / "M" / "B" suffixed number in the row.
    // Pick the largest match — small numbers are usually video counts / ranks.
    const subMatches = [...window.matchAll(/>(\s*[\d,.]+\s*[KMB]?)\s*</g)]
      .map((x) => parseSubs(x[1]))
      .filter((n) => n >= 1000);
    const subscribers = subMatches.length ? Math.max(...subMatches) : 0;

    // Rank: try to read the rank number leading the row.
    const rankMatch = window.match(/(?:rank[^\d]{0,4}|>)#?\s*(\d{1,4})\s*</i);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : undefined;

    candidates.push({ channelId, name, subscribers, sourceFile, rank });
  }
  // De-dup by channelId within a single file (Social Blade renders each row twice
  // in some layouts — collapse to the highest sub count we saw).
  const byId = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = c.channelId || c.handle || normName(c.name);
    const existing = byId.get(key);
    if (!existing || c.subscribers > existing.subscribers) byId.set(key, c);
  }
  return [...byId.values()];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Parse a Social Blade markdown table export (one row per channel).
 * Row shape:
 *   | [Nth](url) | [![](img)Name](url) | [SUBS](url) | [views](url) | [videos](url) |
 *
 * Handle (preferred) is in the URL: /youtube/handle/<handle>. Some legacy
 * Social Blade exports use /youtube/channel/UCxxx; both are captured.
 */
function parseSocialBladeMarkdown(md: string, sourceFile: string): Candidate[] {
  const candidates: Candidate[] = [];
  const lines = md.split("\n");
  for (const line of lines) {
    // A data row starts with `| [<num>` (1st, 2nd, …) and has 5 cells.
    if (!/^\| \[\d+(st|nd|rd|th)\]/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;

    // Rank (cell 0): "[42nd](url)"
    const rankMatch = cells[0].match(/\[(\d+)/);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : undefined;

    // Handle or channelId (any cell — they all repeat the link).
    const handleMatch = line.match(/\/youtube\/handle\/([\w.-]+)/);
    const channelIdMatch = line.match(/\/youtube\/channel\/(UC[\w-]{20,30})/);

    // Name (cell 1): "[![](img)NAME](url)" — strip leading image and trailing url.
    let name = "(unknown)";
    const nameCell = cells[1] || "";
    const nameMatch = nameCell.match(/!\[\]\([^)]+\)([^\]]+)\]/);
    if (nameMatch) name = decodeEntities(nameMatch[1]).trim();

    // Subs (cell 2): "[19.6M](url)"
    let subscribers = 0;
    const subsCell = cells[2] || "";
    const subsMatch = subsCell.match(/\[([\d.,]+\s*[KMB]?)\]/);
    if (subsMatch) subscribers = parseSubs(subsMatch[1]);

    candidates.push({
      handle: handleMatch?.[1],
      channelId: channelIdMatch?.[1],
      name,
      subscribers,
      sourceFile,
      rank,
    });
  }
  return candidates;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: tsx scripts/discover-socialblade.ts <file.html> [file2.html] …");
    console.error("");
    console.error("Save the Social Blade category page(s) as HTML first — they're");
    console.error("Cloudflare-protected, so direct fetch returns a 403 challenge page.");
    process.exit(1);
  }

  // Parse every input file — dispatch by extension.
  const all: Candidate[] = [];
  for (const f of files) {
    const path = resolvePath(f);
    const body = readFileSync(path, "utf8");
    const isMd = /\.md$/i.test(path) || /^\| \[\d+(st|nd|rd|th)\]/m.test(body);
    const found = isMd
      ? parseSocialBladeMarkdown(body, path.split("/").pop() || path)
      : parseSocialBladeHtml(body, path.split("/").pop() || path);
    console.error(`Parsed ${found.length} channels from ${path.split("/").pop()} (${isMd ? "md" : "html"})`);
    all.push(...found);
  }

  // De-dup across files by handle ∪ channelId, keeping highest sub count.
  const merged = new Map<string, Candidate>();
  for (const c of all) {
    const key = c.channelId || c.handle || normName(c.name);
    const existing = merged.get(key);
    if (!existing || c.subscribers > existing.subscribers) merged.set(key, c);
  }
  const uniq = [...merged.values()];
  console.error(`\n${uniq.length} unique channels across all files.`);

  // Sub-floor filter.
  const aboveFloor = uniq.filter((c) => c.subscribers >= SUB_FLOOR);
  console.error(`${aboveFloor.length} ≥ ${(SUB_FLOOR / 1000).toFixed(0)}K subs.\n`);

  // Cross-reference against existing panel.
  const db = createServiceClient();
  const { data: existing } = await db
    .from("channels")
    .select("name, platform_id, platform")
    .eq("active", true);
  const existingIds = new Set(
    (existing || [])
      .filter((c) => c.platform === "youtube")
      .map((c) => c.platform_id),
  );
  const existingNorms = new Map<string, string>();
  for (const c of existing || []) existingNorms.set(normName(c.name), c.name);

  // Sort by subs desc.
  aboveFloor.sort((a, b) => b.subscribers - a.subscribers);

  // Bucket: already-in-panel / legacy / non-political / non-US / alt-candidate.
  const inPanel: Candidate[] = [];
  const legacy: Candidate[] = [];
  const nonPolitical: Candidate[] = [];
  const nonUs: Candidate[] = [];
  const altCandidates: Candidate[] = [];
  const fuzzyMatches = new Map<string, string>(); // candidate.name -> existing name

  for (const c of aboveFloor) {
    const idMatch = c.channelId ? existingIds.has(c.channelId) : false;
    const nameMatch = existingNorms.get(normName(c.name));
    if (idMatch || nameMatch) {
      if (nameMatch) fuzzyMatches.set(c.name, nameMatch);
      inPanel.push(c);
      continue;
    }
    if (isLegacy(c.name)) legacy.push(c);
    else if (isNonUS(c.name, c.handle)) nonUs.push(c);
    else if (isNotPolitical(c.name, c.handle)) nonPolitical.push(c);
    else altCandidates.push(c);
  }

  const fmtSubs = (n: number) =>
    n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n / 1e3).toFixed(0) + "K";
  const fmtRow = (c: Candidate, status: string) => {
    const handleStr = c.handle ? `@${c.handle}` : c.channelId || "?";
    return `${String(c.rank ?? "?").padStart(4)}  ${fmtSubs(c.subscribers).padStart(7)}  ${c.name.slice(0, 30).padEnd(30)}  ${handleStr.slice(0, 24).padEnd(24)}  ${status}`;
  };

  console.log("");
  console.log("═══ ALT-MEDIA CANDIDATES (review for /admin/channels) ═══");
  console.log("RANK  SUBS     NAME                            HANDLE                    STATUS");
  console.log("----  -------  ------------------------------  ------------------------  ------");
  for (const c of altCandidates) console.log(fmtRow(c, "→ CANDIDATE"));
  if (altCandidates.length === 0) console.log("(none above floor)");

  console.log("");
  console.log("═══ LEGACY / MSM (append to docs/legacy-media-wishlist.md) ═══");
  console.log("RANK  SUBS     NAME                            HANDLE                    STATUS");
  console.log("----  -------  ------------------------------  ------------------------  ------");
  for (const c of legacy) console.log(fmtRow(c, "✗ legacy (parked)"));
  if (legacy.length === 0) console.log("(none above floor)");

  console.log("");
  console.log("═══ ALREADY IN PANEL ═══");
  for (const c of inPanel) {
    const matched = fuzzyMatches.get(c.name);
    const status = matched && matched !== c.name ? `✓ as "${matched}"` : "✓ in panel";
    console.log(fmtRow(c, status));
  }
  if (inPanel.length === 0) console.log("(none)");

  console.log("");
  console.log("═══ FILTERED (likely not panel-relevant) ═══");
  console.log("Non-US / non-English:");
  for (const c of nonUs) console.log(fmtRow(c, "  · non-US"));
  if (nonUs.length === 0) console.log("  (none)");
  console.log("Non-political (gaming, true-crime, finance-tutorial, etc.):");
  for (const c of nonPolitical) console.log(fmtRow(c, "  · not political"));
  if (nonPolitical.length === 0) console.log("  (none)");

  console.log("");
  console.log(`Totals (≥${(SUB_FLOOR / 1000).toFixed(0)}K subs):`);
  console.log(`  alt-media candidates: ${altCandidates.length}`);
  console.log(`  legacy / MSM:         ${legacy.length}`);
  console.log(`  filtered (non-US):    ${nonUs.length}`);
  console.log(`  filtered (off-topic): ${nonPolitical.length}`);
  console.log(`  already in panel:     ${inPanel.length}`);
  console.log("");
  console.log("Next: add ALT candidates via /admin/channels (one per line, paste");
  console.log("the @handle). Append LEGACY entries to docs/legacy-media-wishlist.md.");
  console.log("The FILTERED buckets are best-guess and worth a quick eyeball.");
}

main().catch((e) => {
  console.error("Failed:", e?.message || e);
  process.exit(1);
});
