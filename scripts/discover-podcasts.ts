/**
 * Podcast-side candidate finder. Queries the iTunes Search API for several
 * political/news terms, aggregates results, dedups against the existing
 * panel by normalized show name, filters out legacy/traditional-media
 * outlets (per the alt-only v1 scope), and prints a ranked candidate list
 * for editorial triage.
 *
 * Pure read-only. No DB writes; no LLM cost. See
 * docs/channel-expansion-strategy.md for the curation criteria.
 *
 * Run:  npm run discover:podcasts
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { searchITunesPodcasts, type AppleSearchResult } from "@/lib/apple-podcasts";

const SEARCH_TERMS = [
  "politics",
  "political commentary",
  "political news",
  "conservative politics",
  "progressive politics",
  "news commentary",
];

// Networks/outlets that fall outside the alt-only v1 scope. Match on
// artistName (case-insensitive substring).
const LEGACY_ARTIST_PATTERNS = [
  "npr",
  "national public radio",
  "new york times",
  "nyt",
  "cnn",
  "msnbc",
  "nbc news",
  "abc news",
  "cbs news",
  "fox news podcasts",
  "fox news radio",
  "bbc",
  "wall street journal",
  "washington post",
  "pbs",
  "politico",
  "bloomberg",
  "reuters",
  "the atlantic",
  "the economist",
  "time magazine",
  "axios",
  "los angeles times",
  "usa today",
];

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksLegacy(artist: string): boolean {
  const lower = artist.toLowerCase();
  return LEGACY_ARTIST_PATTERNS.some((p) => lower.includes(p));
}

async function main() {
  const db = createServiceClient();
  const { data: chans } = await db.from("channels").select("name").eq("active", true);
  const ourNames = new Set((chans || []).map((c: { name: string }) => normalizeName(c.name)));

  console.log(`\nSearching iTunes Podcasts for political-media candidates (${SEARCH_TERMS.length} terms)…\n`);

  // collectionId → { result, terms-it-appeared-in }
  const merged = new Map<number, { result: AppleSearchResult; terms: Set<string> }>();
  for (const term of SEARCH_TERMS) {
    try {
      const results = await searchITunesPodcasts(term, 50);
      for (const r of results) {
        const cur = merged.get(r.collectionId);
        if (!cur) merged.set(r.collectionId, { result: r, terms: new Set([term]) });
        else cur.terms.add(term);
      }
    } catch (e: any) {
      console.warn(`  [${term}] search failed: ${e.message}`);
    }
  }

  console.log(`${merged.size} unique podcasts surfaced across the searches.\n`);

  const candidates = [...merged.values()]
    // alt-media only
    .filter(({ result }) => !looksLegacy(result.artistName))
    // not already in the panel
    .filter(({ result }) => !ourNames.has(normalizeName(result.collectionName)))
    // require Politics or News in the genre tag (cuts most off-topic noise)
    .filter(({ result }) => {
      const g = (result.primaryGenreName || "").toLowerCase();
      return g.includes("politic") || g.includes("news");
    })
    .sort((a, b) => {
      // More search-term overlap = stronger relevance signal first;
      // then trackCount (mature long-running shows) as tiebreak.
      if (b.terms.size !== a.terms.size) return b.terms.size - a.terms.size;
      return (b.result.trackCount || 0) - (a.result.trackCount || 0);
    });

  // Show top 40
  console.log(`Name · Artist/Network · Genre · Eps · Matched-terms`);
  console.log("─".repeat(72));
  for (const { result, terms } of candidates.slice(0, 40)) {
    const eps = result.trackCount ? String(result.trackCount).padStart(4) : "  - ";
    const matched = terms.size;
    console.log(
      `${result.collectionName}  ·  ${result.artistName}  ·  ${result.primaryGenreName || "?"}  ·  ${eps} eps  ·  ${matched}/${SEARCH_TERMS.length}`,
    );
  }

  console.log(
    `\n${candidates.length} alt-media candidates surfaced ` +
      `(${merged.size - candidates.length} filtered: legacy outlets, off-topic genre, or already in panel).`,
  );
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
