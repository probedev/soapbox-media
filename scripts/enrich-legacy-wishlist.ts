/**
 * Enrich docs/legacy-media-wishlist.md with reach numbers.
 *
 * For each wishlist entry that resolves to a YouTube channel or a PodScan
 * podcast, fetch its subscriber/listener count, then:
 *   1. Print a per-entry log + per-section subtotals + grand total
 *   2. Compare against the live alt-panel reach (sum-by-row & by-unique-show)
 *   3. Append a dated "Reach snapshot" table to the wishlist file
 *
 * Run with:  npm run enrich:legacy-wishlist
 *
 * Source of truth for which entries to look up is the CANDIDATES list below
 * (not the markdown). The markdown is the editorial wishlist; this script's
 * mapping is the look-up plan derived from it. Keep them in sync by hand
 * when adding new entries to either.
 *
 * Cost: ~60 YT-Data-API calls (1 quota unit each, well within free tier) +
 * ~25 PodScan searches (we pay per call; cheap). Wall-clock ~30s.
 */
import "./_load-env";

import * as fs from "node:fs";
import * as path from "node:path";

import { createServiceClient } from "@/lib/db";
import { resolveChannelByHandle } from "@/lib/youtube";
import { searchPodcasts, type PodscanPodcast } from "@/lib/podscan";

type Section =
  | "Cable / broadcast"
  | "Newspapers + digital news"
  | "Public radio"
  | "Wire / international"
  | "Social Blade scrape"
  | "Local affiliates"
  | "Ambiguous";

interface YtCandidate {
  kind: "youtube";
  section: Section;
  name: string;
  handle: string;
}
interface PodCandidate {
  kind: "podcast";
  section: Section;
  name: string;
  query: string;
}
type Candidate = YtCandidate | PodCandidate;

/**
 * Editorial mapping: wishlist entry → API lookup. For cable/broadcast we look
 * up the NETWORK-level YT channel (CNN aggregates Anderson Cooper 360 etc.);
 * individual show YT presence is dominated by the parent channel. For
 * newspapers we look up BOTH the parent YT channel AND the named podcasts —
 * they're separate audiences (YT viewers vs pod listeners).
 *
 * TV-only shows with no meaningful YT/podcast surface (e.g. The Five, Outnumbered)
 * are intentionally omitted — viewership numbers require Nielsen and can't
 * be enriched automatically.
 */
const CANDIDATES: Candidate[] = [
  // ── Cable / broadcast — network YT channels ────────────────────────────
  { kind: "youtube", section: "Cable / broadcast", name: "CNN", handle: "@cnn" },
  { kind: "youtube", section: "Cable / broadcast", name: "MSNBC", handle: "@msnbc" },
  { kind: "youtube", section: "Cable / broadcast", name: "Fox News", handle: "@foxnews" },
  { kind: "youtube", section: "Cable / broadcast", name: "NBC News", handle: "@nbcnews" },
  { kind: "youtube", section: "Cable / broadcast", name: "ABC News", handle: "@abcnews" },
  { kind: "youtube", section: "Cable / broadcast", name: "CBS News", handle: "@cbsnews" },
  { kind: "youtube", section: "Cable / broadcast", name: "PBS NewsHour", handle: "@pbsnewshour" },
  { kind: "youtube", section: "Cable / broadcast", name: "BBC News", handle: "@bbcnews" },

  // ── Newspapers + digital news — parent YT + named pods ─────────────────
  { kind: "youtube", section: "Newspapers + digital news", name: "NYT", handle: "@nytimes" },
  { kind: "podcast", section: "Newspapers + digital news", name: "NYT: Hard Fork", query: "Hard Fork New York Times" },
  { kind: "podcast", section: "Newspapers + digital news", name: "NYT: The Run-Up", query: "The Run-Up New York Times" },
  { kind: "podcast", section: "Newspapers + digital news", name: "NYT: Matter of Opinion", query: "Matter of Opinion" },
  { kind: "youtube", section: "Newspapers + digital news", name: "Washington Post", handle: "@washingtonpost" },
  { kind: "podcast", section: "Newspapers + digital news", name: "WaPo: Post Reports", query: "Post Reports Washington Post" },
  { kind: "youtube", section: "Newspapers + digital news", name: "Wall Street Journal", handle: "@wsj" },
  { kind: "podcast", section: "Newspapers + digital news", name: "WSJ: The Journal", query: "The Journal Wall Street Journal" },
  { kind: "podcast", section: "Newspapers + digital news", name: "WSJ: What's News", query: "What's News WSJ" },
  { kind: "youtube", section: "Newspapers + digital news", name: "Politico", handle: "@politico" },
  { kind: "podcast", section: "Newspapers + digital news", name: "Politico Playbook Daily", query: "Politico Playbook Daily Briefing" },
  { kind: "youtube", section: "Newspapers + digital news", name: "The Atlantic", handle: "@theatlantic" },
  { kind: "podcast", section: "Newspapers + digital news", name: "Radio Atlantic", query: "Radio Atlantic" },
  { kind: "youtube", section: "Newspapers + digital news", name: "The Economist", handle: "@theeconomist" },
  { kind: "podcast", section: "Newspapers + digital news", name: "Economist: Checks and Balance", query: "Checks and Balance Economist" },
  { kind: "podcast", section: "Newspapers + digital news", name: "Economist: The Intelligence", query: "The Intelligence Economist" },
  { kind: "youtube", section: "Newspapers + digital news", name: "Vox", handle: "@vox" },
  { kind: "podcast", section: "Newspapers + digital news", name: "Today Explained", query: "Today Explained Vox" },
  { kind: "podcast", section: "Newspapers + digital news", name: "The Weeds", query: "The Weeds Vox" },
  { kind: "youtube", section: "Newspapers + digital news", name: "Bloomberg", handle: "@markets" },
  { kind: "podcast", section: "Newspapers + digital news", name: "Bloomberg Daybreak", query: "Bloomberg Daybreak" },

  // ── Public radio (NPR) ─────────────────────────────────────────────────
  { kind: "youtube", section: "Public radio", name: "NPR", handle: "@npr" },
  { kind: "podcast", section: "Public radio", name: "NPR Up First", query: "Up First NPR" },
  { kind: "podcast", section: "Public radio", name: "NPR Politics Podcast", query: "NPR Politics Podcast" },
  { kind: "podcast", section: "Public radio", name: "Throughline", query: "Throughline NPR" },
  { kind: "podcast", section: "Public radio", name: "Consider This", query: "Consider This NPR" },
  { kind: "podcast", section: "Public radio", name: "Fresh Air", query: "Fresh Air NPR" },

  // ── Wire / international ───────────────────────────────────────────────
  { kind: "youtube", section: "Wire / international", name: "Associated Press", handle: "@AP" },
  { kind: "podcast", section: "Wire / international", name: "AP Headline News", query: "AP Headline News" },
  { kind: "youtube", section: "Wire / international", name: "Reuters", handle: "@reuters" },
  { kind: "podcast", section: "Wire / international", name: "Reuters World News", query: "Reuters World News" },
  { kind: "youtube", section: "Wire / international", name: "France 24 English", handle: "@FRANCE24English" },
  { kind: "youtube", section: "Wire / international", name: "Al Jazeera English", handle: "@aljazeeraenglish" },
  { kind: "youtube", section: "Wire / international", name: "Deutsche Welle News", handle: "@dwnews" },

  // ── Social Blade scrape (refresh today's numbers) ──────────────────────
  { kind: "youtube", section: "Social Blade scrape", name: "NewsNation", handle: "@newsnation" },
  { kind: "youtube", section: "Social Blade scrape", name: "Newsmax", handle: "@newsmaxtv" },
  { kind: "youtube", section: "Social Blade scrape", name: "Fox Business", handle: "@foxbusiness" },
  { kind: "youtube", section: "Social Blade scrape", name: "CNBC Television", handle: "@cnbctelevision" },
  { kind: "youtube", section: "Social Blade scrape", name: "LiveNOW from FOX", handle: "@livenowfox" },
  { kind: "youtube", section: "Social Blade scrape", name: "VICE News", handle: "@vicenews" },
  { kind: "youtube", section: "Social Blade scrape", name: "Inside Edition", handle: "@insideedition" },
  { kind: "youtube", section: "Social Blade scrape", name: "NowThis", handle: "@nowthis" },
  { kind: "youtube", section: "Social Blade scrape", name: "NowThis Impact", handle: "@nowthisimpact" },
  { kind: "youtube", section: "Social Blade scrape", name: "Forbes Breaking News", handle: "@forbesbreakingnews" },
  { kind: "youtube", section: "Social Blade scrape", name: "New York Post", handle: "@nypost" },
  { kind: "youtube", section: "Social Blade scrape", name: "USA TODAY", handle: "@usatoday" },
  { kind: "youtube", section: "Social Blade scrape", name: "Business Insider", handle: "@businessinsider" },
  { kind: "youtube", section: "Social Blade scrape", name: "COURT TV", handle: "@courttv" },
  { kind: "youtube", section: "Social Blade scrape", name: "AJ+", handle: "@ajplus" },

  // ── Local affiliates (deprioritized — narrow geo scope) ────────────────
  { kind: "youtube", section: "Local affiliates", name: "ABC7 NYC", handle: "@abc7ny" },
  { kind: "youtube", section: "Local affiliates", name: "11Alive Atlanta", handle: "@11alive" },
  { kind: "youtube", section: "Local affiliates", name: "WFAA Dallas", handle: "@wfaa8" },

  // ── Ambiguous (alt vs legacy) ──────────────────────────────────────────
  { kind: "youtube", section: "Ambiguous", name: "The Daily Wire (master)", handle: "@dailywire" },
];

interface Result {
  candidate: Candidate;
  reach: number | null;
  matchedTitle?: string;
  error?: string;
}

/** Same field-fallback logic as scripts/seed-podcasts.ts:pickReach. */
function pickPodReach(p: PodscanPodcast): number {
  const candidates: unknown[] = [
    p.reach,
    p.reach_estimate,
    (p as any).audience_size,
    (p as any).monthly_listeners,
    (p as any).audience,
    (p as any).estimated_audience,
  ];
  for (const c of candidates) {
    const n = typeof c === "string" ? parseInt(c, 10) : (c as number);
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toString();
}

async function main() {
  console.log(`\nLegacy wishlist enrichment — looking up ${CANDIDATES.length} candidates`);
  console.log("─".repeat(72));

  const results: Result[] = [];

  for (let i = 0; i < CANDIDATES.length; i++) {
    const c = CANDIDATES[i];
    const prefix = `[${String(i + 1).padStart(2)}/${CANDIDATES.length}] ${c.kind === "youtube" ? "YT" : "Pod"} ${c.name.slice(0, 36).padEnd(36)}`;
    try {
      if (c.kind === "youtube") {
        const info = await resolveChannelByHandle(c.handle);
        if (!info) {
          console.log(`${prefix} ✗ no channel for ${c.handle}`);
          results.push({ candidate: c, reach: null, error: `no channel for ${c.handle}` });
        } else {
          console.log(`${prefix} ${formatReach(info.subscriberCount).padStart(8)} subs   ${info.title.slice(0, 32)}`);
          results.push({ candidate: c, reach: info.subscriberCount, matchedTitle: info.title });
        }
      } else {
        const matches = await searchPodcasts(c.query);
        const top = matches[0];
        if (!top) {
          console.log(`${prefix} ✗ no PodScan match for "${c.query}"`);
          results.push({ candidate: c, reach: null, error: `no PodScan match` });
        } else {
          const reach = pickPodReach(top);
          const matched = top.podcast_name || top.title || top.name || "(untitled)";
          if (reach === 0) {
            console.log(`${prefix} ${"?".padStart(8)}        matched "${matched.slice(0, 32)}" but no reach field`);
            results.push({ candidate: c, reach: null, matchedTitle: matched, error: "matched but no reach" });
          } else {
            console.log(`${prefix} ${formatReach(reach).padStart(8)} reach  ${matched.slice(0, 32)}`);
            results.push({ candidate: c, reach, matchedTitle: matched });
          }
        }
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message?.slice(0, 80) || String(e);
      console.log(`${prefix} ✗ ${msg}`);
      results.push({ candidate: c, reach: null, error: msg });
    }
    // Small pace between calls — well under quota, but defensive against any
    // burst rate-limits on the PodScan side.
    await new Promise((r) => setTimeout(r, 100));
  }

  // ── Section subtotals ──────────────────────────────────────────────────
  const bySection = new Map<string, { found: number; missing: number; reach: number }>();
  for (const r of results) {
    const s = bySection.get(r.candidate.section) || { found: 0, missing: 0, reach: 0 };
    if (r.reach !== null) {
      s.found += 1;
      s.reach += r.reach;
    } else {
      s.missing += 1;
    }
    bySection.set(r.candidate.section, s);
  }

  console.log("\n" + "─".repeat(72));
  console.log("SECTION SUBTOTALS\n");
  let grandTotal = 0;
  // Stable order (insertion order of CANDIDATES) — the Map preserves it.
  for (const [section, stats] of bySection) {
    console.log(
      `  ${section.padEnd(30)} ${formatReach(stats.reach).padStart(8)}   ` +
        `(${stats.found} found, ${stats.missing} missing)`,
    );
    grandTotal += stats.reach;
  }

  // ── Alt panel comparison ───────────────────────────────────────────────
  const db = createServiceClient();
  const channelsRows: { name: string; reach: number | string | null }[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("channels")
      .select("name, reach")
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    channelsRows.push(...(data as { name: string; reach: number | string | null }[]));
  }
  const altByRow = channelsRows.reduce((s, c) => s + Number(c.reach || 0), 0);
  const byName = new Map<string, number>();
  for (const c of channelsRows) {
    const r = Number(c.reach || 0);
    if (r > (byName.get(c.name) || 0)) byName.set(c.name, r);
  }
  const altByUnique = [...byName.values()].reduce((s, v) => s + v, 0);

  console.log("\n" + "─".repeat(72));
  console.log(`LEGACY GRAND TOTAL:     ${formatReach(grandTotal).padStart(8)}   ` +
    `(${results.filter((r) => r.reach !== null).length}/${results.length} resolved)`);
  console.log(
    `ALT PANEL (by row):     ${formatReach(altByRow).padStart(8)}   ` +
      `(${channelsRows.length} active rows)`,
  );
  console.log(
    `ALT PANEL (by show):    ${formatReach(altByUnique).padStart(8)}   ` +
      `(${byName.size} unique shows)`,
  );
  console.log(
    `RATIO legacy/alt-row:   ${(grandTotal / altByRow).toFixed(2)}x`,
  );
  console.log(
    `RATIO legacy/alt-show:  ${(grandTotal / altByUnique).toFixed(2)}x`,
  );

  // ── Append dated snapshot to wishlist markdown ─────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const snapshotPath = path.join(process.cwd(), "docs", "legacy-media-wishlist.md");
  const md: string[] = [];
  md.push("");
  md.push(`## Reach snapshot — ${today}`);
  md.push("");
  md.push(
    "Auto-generated by `npm run enrich:legacy-wishlist`. YT subs via YouTube " +
      "Data API; podcast reach via PodScan (same `pickReach` field-fallback " +
      "logic as `scripts/seed-podcasts.ts`). Re-run anytime to refresh.",
  );
  md.push("");
  md.push("### Per-entry");
  md.push("");
  md.push("| Section | Name | Kind | Source | Reach |");
  md.push("|---|---|---|---|---:|");
  for (const r of results) {
    const kindLabel = r.candidate.kind === "youtube" ? "YT" : "Pod";
    const source =
      r.candidate.kind === "youtube"
        ? `\`${r.candidate.handle}\``
        : `_"${(r.candidate as PodCandidate).query}"_`;
    const reach =
      r.reach !== null
        ? formatReach(r.reach)
        : r.error
          ? `— _${r.error}_`
          : "—";
    md.push(
      `| ${r.candidate.section} | ${r.candidate.name} | ${kindLabel} | ${source} | ${reach} |`,
    );
  }
  md.push("");
  md.push("### Section subtotals");
  md.push("");
  md.push("| Section | Reach | Found | Missing |");
  md.push("|---|---:|---:|---:|");
  for (const [section, stats] of bySection) {
    md.push(
      `| ${section} | ${formatReach(stats.reach)} | ${stats.found} | ${stats.missing} |`,
    );
  }
  md.push("");
  md.push("### Headline comparison");
  md.push("");
  md.push(`- **Legacy grand total:** ${formatReach(grandTotal)} (${results.filter((r) => r.reach !== null).length}/${results.length} entries resolved)`);
  md.push(`- **Alt panel by row:** ${formatReach(altByRow)} (${channelsRows.length} active rows)`);
  md.push(`- **Alt panel by unique show:** ${formatReach(altByUnique)} (${byName.size} shows)`);
  md.push(`- **Ratio (legacy / alt-by-row):** ${(grandTotal / altByRow).toFixed(2)}×`);
  md.push(`- **Ratio (legacy / alt-by-show):** ${(grandTotal / altByUnique).toFixed(2)}×`);
  md.push("");
  md.push(
    "_Caveat: YT subs, podcast monthly listeners, and (omitted) TV viewership " +
      "aren't directly comparable units, but they're what the existing alt-panel " +
      "`channels.reach` column also mixes — so log10-weighted contributions in " +
      "the Index are at least consistent across cohorts._",
  );
  md.push("");

  fs.appendFileSync(snapshotPath, md.join("\n"));
  console.log(`\nSnapshot appended to ${snapshotPath}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
