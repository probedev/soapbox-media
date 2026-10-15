/**
 * Public Figures roster refresh for the 2026 midterms (v0.40.2).
 *
 * The roster (`figures` table) had not changed since it was seeded on
 * 2026-06-23, so /figures read like a June cast list. A scan of the 2,646
 * transcripts published in the 14 days to 2026-10-15 ranked people by
 * episodes mentioning them; this adds the Senate-map and administration names
 * above the 60-episode line and fixes two ASR alias gaps on existing rows.
 * Trump stays held on purpose (he appears in roughly a third of all
 * episodes and would saturate the board).
 *
 * Idempotent: existing slugs are skipped, alias lists are replaced with the
 * superset below. Follow with:
 *   npm run detect:figures -- 30      (regex, free: a month of mentions)
 *   npm run score:figures -- 12000 15 (Haiku, roughly a tenth of a cent each)
 *   npm run refresh:boards            (rebuild the /figures board)
 *
 * Run:  npm run seed:figures-midterms
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";

const ADDITIONS = [
  { slug: "paxton", name: "Ken Paxton", affiliation: "R", aliases: ["ken paxton", "paxton"] },
  {
    slug: "talarico",
    name: "James Talarico",
    affiliation: "D",
    aliases: ["james talarico", "talarico", "james tallarico", "tallarico"],
  },
  { slug: "mike-rogers", name: "Mike Rogers", affiliation: "R", aliases: ["mike rogers"] },
  {
    slug: "susan-collins",
    name: "Susan Collins",
    affiliation: "R",
    aliases: ["susan collins", "senator collins"],
  },
  { slug: "troy-jackson", name: "Troy Jackson", affiliation: "D", aliases: ["troy jackson"] },
  { slug: "sherrod-brown", name: "Sherrod Brown", affiliation: "D", aliases: ["sherrod brown", "sherrod"] },
  { slug: "ossoff", name: "Jon Ossoff", affiliation: "D", aliases: ["jon ossoff", "john ossoff", "ossoff"] },
  { slug: "rubio", name: "Marco Rubio", affiliation: "R", aliases: ["marco rubio", "rubio", "secretary rubio"] },
  { slug: "hegseth", name: "Pete Hegseth", affiliation: "R", aliases: ["pete hegseth", "hegseth"] },
  { slug: "mike-johnson", name: "Mike Johnson", affiliation: "R", aliases: ["mike johnson", "speaker johnson"] },
] as const;

/** ASR spellings seen in transcripts: "Mom Donnie" is Mamdani in 58 recent
 *  episodes, "Kla Harris" is Kamala Harris in 47. */
const ALIAS_FIXES: Record<string, string[]> = {
  mamdani: ["mamdani", "zohran", "mom donnie"],
  kamala: ["kamala", "kamala harris", "vice president harris", "kla harris"],
};

async function main() {
  const db = createServiceClient();

  const { data: existing, error: exErr } = await db
    .from("figures")
    .select("slug")
    .in("slug", ADDITIONS.map((a) => a.slug));
  if (exErr) throw new Error(`figures lookup: ${exErr.message}`);
  const present = new Set((existing || []).map((e: { slug: string }) => e.slug));
  const toInsert = ADDITIONS.filter((a) => !present.has(a.slug)).map((a) => ({
    ...a,
    aliases: [...a.aliases],
    kind: "person",
    active: true,
  }));
  if (present.size > 0) console.log(`already present, skipped: ${[...present].join(", ")}`);

  if (toInsert.length > 0) {
    const { error } = await db.from("figures").insert(toInsert);
    if (error) throw new Error(`figures insert: ${error.message}`);
  }
  console.log(`inserted ${toInsert.length} figures: ${toInsert.map((f) => f.slug).join(", ") || "(none)"}`);

  for (const [slug, aliases] of Object.entries(ALIAS_FIXES)) {
    const { error } = await db.from("figures").update({ aliases }).eq("slug", slug);
    if (error) throw new Error(`alias update ${slug}: ${error.message}`);
    console.log(`aliases set: ${slug} -> ${JSON.stringify(aliases)}`);
  }

  const { count } = await db.from("figures").select("*", { count: "exact", head: true }).eq("active", true);
  console.log(`active figures now: ${count}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
