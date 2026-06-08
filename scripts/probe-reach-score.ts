/**
 * READ-ONLY probe: can PodScan's relative `podcast_reach_score` (PRS) be
 * calibrated into usable absolute reach for the 77 placeholder podcasts?
 *
 * Method: the ~30 podcasts with trusted editorial reach (reach ≠ 300k) are
 * anchors. Fit log10(reach) ~ PRS by OLS on the anchors, report Spearman rank
 * correlation + R² + per-anchor residuals, then print what each placeholder
 * channel WOULD get. No DB writes — output is a review table only.
 *
 * Run:  npx tsx scripts/probe-reach-score.ts
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getPodcastById } from "@/lib/podscan";

const PLACEHOLDER = 300_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull every plausible relative-score field; PodScan key names have shifted. */
function pickScore(p: Record<string, any>): number | null {
  const cands = [
    p.podcast_reach_score,
    p.reach_score,
    p.podcast_ranking_score,
    p.prs,
    p.reach?.podcast_reach_score,
    p.reach?.score,
  ];
  for (const c of cands) {
    const n = typeof c === "string" ? parseFloat(c) : (c as number);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length).fill(0);
    idx.forEach(([, i], pos) => (r[i] = pos + 1));
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n ** 2 - 1));
}

async function main() {
  const db = createServiceClient();
  const { data: chans, error } = await db
    .from("channels")
    .select("id, name, platform_id, reach")
    .eq("platform", "podcast")
    .eq("active", true)
    .order("reach", { ascending: false });
  if (error || !chans) throw new Error(`load channels: ${error?.message}`);

  console.log(`Probing PodScan reach score for ${chans.length} podcasts…\n`);

  const rows: { name: string; reach: number; score: number | null }[] = [];
  let sampleDumped = false;
  for (const c of chans) {
    const p = await getPodcastById(c.platform_id);
    const score = p ? pickScore(p) : null;
    if (p && !sampleDumped) {
      // One-time field inventory so we can see what PodScan actually returns
      const keys = Object.keys(p).filter((k) => /reach|score|rank|audien|listen/i.test(k));
      console.log(`[sample: ${c.name}] score-ish fields:`, JSON.stringify(
        Object.fromEntries(keys.map((k) => [k, p[k]])), null, 0).slice(0, 600), "\n");
      sampleDumped = true;
    }
    rows.push({ name: c.name, reach: Number(c.reach), score });
    await sleep(150);
  }

  const anchors = rows.filter((r) => r.reach !== PLACEHOLDER && r.score !== null);
  const placeholders = rows.filter((r) => r.reach === PLACEHOLDER);
  const missing = rows.filter((r) => r.score === null);
  console.log(`anchors with score: ${anchors.length} · placeholders: ${placeholders.length} · no score returned: ${missing.length}`);
  if (missing.length) console.log(`  missing: ${missing.map((m) => m.name).join(", ")}`);

  if (anchors.length < 8) {
    console.log("\nToo few scored anchors to calibrate — PRS not viable as-is.");
    return;
  }

  // OLS fit: log10(reach) = a + b * score
  const xs = anchors.map((r) => r.score as number);
  const ys = anchors.map((r) => Math.log10(r.reach));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) /
            xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const a = my - b * mx;
  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (a + b * xs[i])) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  const rho = spearman(xs, ys);
  const predict = (score: number) => Math.round(10 ** (a + b * score));

  console.log(`\nFIT on ${n} anchors: log10(reach) = ${a.toFixed(3)} + ${b.toFixed(4)}·score`);
  console.log(`Spearman ρ = ${rho.toFixed(3)} · R² = ${r2.toFixed(3)}  (ρ ≥ ~0.7 = usable ordering)\n`);

  console.log("ANCHORS — predicted vs editorial (sanity check):");
  for (const r of [...anchors].sort((p1, p2) => p2.reach - p1.reach)) {
    const pred = predict(r.score as number);
    const ratio = pred / r.reach;
    const flag = ratio > 3 || ratio < 1 / 3 ? "  ⚠️" : "";
    console.log(`  ${r.name.slice(0, 38).padEnd(38)} score ${String(r.score).padStart(5)} · editorial ${fmt(r.reach).padStart(7)} → pred ${fmt(pred).padStart(7)} (${ratio.toFixed(2)}×)${flag}`);
  }

  console.log("\nPLACEHOLDERS — what each would get (NO writes performed):");
  const scored = placeholders.filter((r) => r.score !== null)
    .sort((p1, p2) => (p2.score as number) - (p1.score as number));
  for (const r of scored) {
    console.log(`  ${r.name.slice(0, 38).padEnd(38)} score ${String(r.score).padStart(5)} → ${fmt(predict(r.score as number)).padStart(7)}`);
  }
  const unscored = placeholders.filter((r) => r.score === null);
  if (unscored.length) console.log(`\n  no score (would stay 300k pending editorial): ${unscored.map((r) => r.name).join(", ")}`);
}

function fmt(x: number): string {
  if (x >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return Math.round(x / 1e3) + "k";
  return String(x);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
