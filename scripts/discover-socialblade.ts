/**
 * scripts/discover-socialblade.ts — one-time parse of saved Social Blade
 * "Top Channels by Category" HTML pages.
 *
 * Social Blade is Cloudflare-protected and rejects direct curl/fetch. To use
 * this script:
 *   1. In a browser, open one or more of:
 *        https://socialblade.com/youtube/top/category/politics
 *        https://socialblade.com/youtube/top/category/news
 *        https://socialblade.com/youtube/top/category/nonprofits-activism
 *   2. Save each page as HTML (Cmd-S → "Web Page, HTML Only").
 *   3. Run: `tsx scripts/discover-socialblade.ts <path1.html> [path2.html] …`
 *
 * The parser:
 *   • Extracts every `/youtube/channel/UCxxx` link (with the displayed name +
 *     subscriber count from the same row).
 *   • Filters to ≥300K subscribers (the panel's sub-floor).
 *   • Cross-references against the existing `channels` table by both
 *     YT channel ID (exact) and normalized name (fuzzy).
 *   • Prints a sorted candidate list with dedup status, suitable for review
 *     and feeding into the `/admin/channels` add-flow.
 *
 * Output is text only; this script never writes to the DB.
 */
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import "dotenv/config";
import { createServiceClient } from "../src/lib/db";

const SUB_FLOOR = 300_000;

interface Candidate {
  channelId: string; // UCxxxx (or null if Social Blade row used the legacy /user/ form)
  name: string;
  subscribers: number;
  sourceFile: string;
  rank?: number;
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

/** Normalize a channel name for fuzzy compare: lowercase, strip punctuation/whitespace. */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&amp;/g, "&")
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
    const existing = byId.get(c.channelId);
    if (!existing || c.subscribers > existing.subscribers) byId.set(c.channelId, c);
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

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: tsx scripts/discover-socialblade.ts <file.html> [file2.html] …");
    console.error("");
    console.error("Save the Social Blade category page(s) as HTML first — they're");
    console.error("Cloudflare-protected, so direct fetch returns a 403 challenge page.");
    process.exit(1);
  }

  // Parse every input file.
  const all: Candidate[] = [];
  for (const f of files) {
    const path = resolvePath(f);
    const html = readFileSync(path, "utf8");
    const found = parseSocialBladeHtml(html, path.split("/").pop() || path);
    console.error(`Parsed ${found.length} channels from ${path.split("/").pop()}`);
    all.push(...found);
  }

  // De-dup across files by channelId.
  const byId = new Map<string, Candidate>();
  for (const c of all) {
    const existing = byId.get(c.channelId);
    if (!existing || c.subscribers > existing.subscribers) byId.set(c.channelId, c);
  }
  const merged = [...byId.values()];
  console.error(`\n${merged.length} unique channels across all files.`);

  // Sub-floor filter.
  const aboveFloor = merged.filter((c) => c.subscribers >= SUB_FLOOR);
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

  // Sort by subs desc and bucket into already-in-panel vs candidates.
  aboveFloor.sort((a, b) => b.subscribers - a.subscribers);

  console.log("RANK  SUBS         NAME                                  STATUS");
  console.log("----  -----------  ------------------------------------  ------------------");
  let candidateCount = 0;
  let alreadyCount = 0;
  for (const c of aboveFloor) {
    const inPanelById = existingIds.has(c.channelId);
    const fuzzy = existingNorms.get(normName(c.name));
    const status = inPanelById
      ? "✓ in panel (id)"
      : fuzzy
        ? `~ fuzzy: ${fuzzy}`
        : "→ CANDIDATE";
    if (inPanelById || fuzzy) alreadyCount++;
    else candidateCount++;
    const subs = c.subscribers >= 1e6
      ? (c.subscribers / 1e6).toFixed(1) + "M"
      : (c.subscribers / 1e3).toFixed(0) + "K";
    console.log(
      `${String(c.rank ?? "?").padStart(4)}  ${subs.padStart(11)}  ${c.name.slice(0, 36).padEnd(36)}  ${status}`,
    );
  }
  console.log("");
  console.log(`Total ≥${(SUB_FLOOR / 1000).toFixed(0)}K: ${aboveFloor.length}`);
  console.log(`  already in panel: ${alreadyCount}`);
  console.log(`  new candidates:   ${candidateCount}`);
  console.log("");
  console.log("Add via /admin/channels using each candidate's YouTube handle.");
}

main().catch((e) => {
  console.error("Failed:", e?.message || e);
  process.exit(1);
});
