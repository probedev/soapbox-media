/**
 * READ-ONLY probe: calibrate Podchaser's Power Score (0–100, Starter tier)
 * against our editorial reach anchors, exactly like the PodScan PRS probe
 * (which failed: ρ=0.09). If Power Score orders the anchors well, it becomes
 * the modeled-reach source for the 77 placeholder podcasts.
 *
 * Rate-limit-respecting (v2 — the first run got WAF-banned): ~27 req/min
 * pacing, honors Retry-After on 429, aborts immediately on 403 so we don't
 * extend a ban. Successful lookups are cached in CACHE_PATH (errors are NOT
 * cached), so an interrupted run resumes where it left off. Starter quota =
 * 1,000 req/mo; full cold run ≈ 214 requests. No DB writes.
 *
 * Run:  npx tsx scripts/probe-podchaser.ts
 */
import "./_load-env";

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createServiceClient } from "@/lib/db";

const API = "https://developers.podchaser.com/api/rest/v1";
const KEY = process.env.PODCHASER_API_KEY;
const CACHE_PATH = "/tmp/podchaser-probe-cache.json";
const PLACEHOLDER = 300_000;
const PACE_MS = 4_000; // ~15 req/min — the WAF banned 27/min runs twice
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CacheEntry { ok: true; id: string | null; matchedTitle: string | null; powerScore: number | null }
type Cache = Record<string, CacheEntry>;

class BannedError extends Error {}

async function pc<T>(path: string): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: {
      "x-api-key": KEY!, Accept: "application/json",
      // Identify ourselves — the WAF banned two anonymous-UA runs
      "User-Agent": "soapbox-reach-probe/1.0 (one-time panel calibration)",
    } });
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 403) throw new BannedError("403 — WAF ban; stop the run, retry later");
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 21;
      console.log(`  [429] waiting ${retryAfter + 1}s (attempt ${attempt}/5)…`);
      await sleep((retryAfter + 1) * 1000);
      continue;
    }
    throw new Error(`Podchaser ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`Podchaser ${path}: still 429 after 5 attempts`);
}

// Same anchor-token title guard as recover-feeds; parentheticals are our own
// annotations ("Morning Wire (Daily Wire)"), not part of the feed title —
// strip them from both the query and the match anchor.
const STOP = new Set(["the", "a", "an", "and", "or", "with", "in", "it", "of", "to", "for", "show", "podcast", "pod", "daily", "w"]);
function cleanName(name: string): string { return name.replace(/\s*\([^)]*\)/g, "").trim(); }
function anchorToken(name: string): string {
  const toks = cleanName(name).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));
  return toks.sort((x, y) => y.length - x.length)[0] || "";
}
function titleMatches(showName: string, title: string): boolean {
  const a = anchorToken(showName);
  return !a || title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(a);
}

async function lookup(name: string, cache: Cache): Promise<CacheEntry> {
  if (cache[name]?.ok) return cache[name];
  const search = await pc<{ data: { id: string; title: string }[] }>(
    `/search/podcasts?q=${encodeURIComponent(cleanName(name))}&per_page=5`);
  await sleep(PACE_MS);
  let entry: CacheEntry = { ok: true, id: null, matchedTitle: null, powerScore: null };
  const hit = (search.data || []).find((p) => titleMatches(name, p.title));
  if (hit) {
    const reach = await pc<{ data: { powerScore?: number } }>(`/podcasts/${hit.id}/reach`);
    await sleep(PACE_MS);
    entry = { ok: true, id: hit.id, matchedTitle: hit.title,
      powerScore: Number.isFinite(reach.data?.powerScore) ? (reach.data.powerScore as number) : null };
  }
  cache[name] = entry; // only successful lookups reach this line
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  return entry;
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length).fill(0);
    idx.forEach(([, i], pos) => (r[i] = pos + 1));
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n ** 2 - 1));
}

function fmt(x: number): string {
  if (x >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return Math.round(x / 1e3) + "k";
  return String(x);
}

async function main() {
  if (!KEY) throw new Error("PODCHASER_API_KEY missing from .env.local");
  // Drop legacy/error entries (pre-v2 cache had no `ok` flag)
  const rawCache: Record<string, any> = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
  const cache: Cache = Object.fromEntries(Object.entries(rawCache).filter(([, v]) => v?.ok && v.id !== null));

  const db = createServiceClient();
  const { data: chans, error } = await db
    .from("channels")
    .select("name, reach")
    .eq("platform", "podcast")
    .eq("active", true)
    .order("reach", { ascending: false });
  if (error || !chans) throw new Error(`load channels: ${error?.message}`);
  // Dedupe by name (DB has a couple of duplicate-name podcast rows)
  const seen = new Set<string>();
  const unique = chans.filter((c: any) => !seen.has(c.name) && seen.add(c.name));

  console.log(`Probing Podchaser Power Score for ${unique.length} podcasts (cache: ${Object.keys(cache).length} warm)…\n`);
  const rows: { name: string; reach: number; score: number | null; matched: string | null }[] = [];
  try {
    for (const c of unique) {
      const e = await lookup(c.name, cache);
      rows.push({ name: c.name, reach: Number(c.reach), score: e.powerScore, matched: e.matchedTitle });
    }
  } catch (e) {
    if (e instanceof BannedError) {
      console.error(`\nABORTED: ${e.message}. Progress is cached (${Object.keys(cache).length} shows) — re-run later to resume.`);
      process.exit(2);
    }
    throw e;
  }

  const anchors = rows.filter((r) => r.reach !== PLACEHOLDER && r.score !== null);
  const placeholders = rows.filter((r) => r.reach === PLACEHOLDER);
  const unmatched = rows.filter((r) => r.score === null);
  console.log(`anchors with score: ${anchors.length} · placeholders: ${placeholders.length} · no match/score: ${unmatched.length}`);
  if (unmatched.length) console.log(`  unmatched: ${unmatched.map((m) => m.name).join(", ")}`);

  if (anchors.length < 8) { console.log("\nToo few scored anchors to calibrate."); return; }

  const xs = anchors.map((r) => r.score as number);
  const ys = anchors.map((r) => Math.log10(r.reach));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const a = my - b * mx;
  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (a + b * xs[i])) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  const rho = spearman(xs, ys);
  const predict = (score: number) => Math.round(10 ** (a + b * score));

  console.log(`\nFIT on ${n} anchors: log10(reach) = ${a.toFixed(3)} + ${b.toFixed(4)}·powerScore`);
  console.log(`Spearman ρ = ${rho.toFixed(3)} · R² = ${r2.toFixed(3)}  (ρ ≥ ~0.7 = usable ordering)\n`);

  console.log("ANCHORS — predicted vs editorial:");
  for (const r of [...anchors].sort((p, q) => q.reach - p.reach)) {
    const pred = predict(r.score as number);
    const ratio = pred / r.reach;
    const flag = ratio > 3 || ratio < 1 / 3 ? "  ⚠️" : "";
    const mism = r.matched && !titleMatches(r.name, r.matched) ? ` [matched: ${r.matched}]` : "";
    console.log(`  ${r.name.slice(0, 38).padEnd(38)} pwr ${String(r.score).padStart(6)} · editorial ${fmt(r.reach).padStart(7)} → pred ${fmt(pred).padStart(7)} (${ratio.toFixed(2)}×)${flag}${mism}`);
  }

  console.log("\nPLACEHOLDERS — what each would get (NO writes performed):");
  for (const r of placeholders.filter((p) => p.score !== null).sort((p, q) => (q.score as number) - (p.score as number))) {
    console.log(`  ${r.name.slice(0, 38).padEnd(38)} pwr ${String(r.score).padStart(6)} → ${fmt(predict(r.score as number)).padStart(7)}   [${r.matched}]`);
  }
  const noScore = placeholders.filter((p) => p.score === null);
  if (noScore.length) console.log(`\n  no score (stay 300k pending editorial): ${noScore.map((r) => r.name).join(", ")}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
