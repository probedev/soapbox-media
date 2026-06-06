/**
 * Data assembly for /admin/homelab — the private mock-up page where all 14
 * proposed home-page cards render against LIVE data so the v1 cut can be
 * chosen by looking, not guessing. Read-only; pragmatic single-pass queries
 * (this page may take ~10s — fine for an admin decision tool, NOT the shape
 * production cards will use; those will be folded into the home snapshot).
 *
 * All weighting matches the Index: weight = intensity × log10(reach);
 * lean = Σ(sent·w)/Σw; index = clip(lean × 2, −10, +10).
 */
import { createServiceClient } from "@/lib/db";

export interface LabRow {
  sent: number;
  inten: number;
  issue_slug: string;
  issue_name: string;
  topic_slug: string | null;
  published_at: string;
  ch_id: string;
  ch_name: string;
  lean: "L" | "M" | "R";
  cohort: "independent" | "legacy";
  platform: "youtube" | "podcast";
  reach: number;
}

const DAY = 86_400_000;
const rf = (reach: number) => Math.log10(Math.max(reach, 10));
const w = (r: LabRow) => r.inten * rf(r.reach);
const clip = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function weightedIndex(rows: LabRow[]): number | null {
  let sw = 0, sws = 0;
  for (const r of rows) { const wt = w(r); sw += wt; sws += wt * r.sent; }
  return sw > 0 ? clip((sws / sw) * 2, -10, 10) : null;
}

/** Paginated 90-day scored-mention pull. Stable PK order, empty-page-only
 *  termination — see [[pagination-stable-order]]. No quote text (kept light);
 *  receipts/cross-talk fetch quotes separately. */
async function fetchLabRows(days = 90): Promise<LabRow[]> {
  const db = createServiceClient();
  const cutoff = new Date(Date.now() - days * DAY).toISOString();
  const all: LabRow[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 60; page++) {
    const { data, error } = await db
      .from("sentiment_scores")
      .select(
        `id, sentiment, intensity,
         classification:classifications!sentiment_scores_classification_id_fkey!inner (
           issue_slug,
           issue:issues!classifications_issue_slug_fkey!inner ( name, topic_slug ),
           episode:episodes!classifications_episode_id_fkey!inner (
             published_at,
             channel:channels!episodes_channel_id_fkey!inner (
               id, name, political_lean, cohort, platform, reach, active
             )
           )
         )`,
      )
      .eq("classification.episode.channel.active", true)
      .gte("classification.episode.published_at", cutoff)
      .order("id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`fetchLabRows: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const c = r.classification, e = c.episode, ch = e.channel;
      all.push({
        sent: Number(r.sentiment), inten: Number(r.intensity),
        issue_slug: c.issue_slug, issue_name: c.issue?.name ?? c.issue_slug,
        topic_slug: c.issue?.topic_slug ?? null,
        published_at: e.published_at,
        ch_id: ch.id, ch_name: ch.name, lean: ch.political_lean,
        cohort: ch.cohort, platform: ch.platform, reach: Number(ch.reach),
      });
    }
  }
  return all;
}

const inWindow = (rows: LabRow[], days: number, endOffsetDays = 0) => {
  const end = Date.now() - endOffsetDays * DAY;
  const start = end - days * DAY;
  return rows.filter((r) => { const t = Date.parse(r.published_at); return t >= start && t < end; });
};

// ── #1 Pulse ────────────────────────────────────────────────────────────────
export interface Pulse {
  episodes7d: number; mentions7d: number; hours7d: number;
  channels: number; episodesDelta: number; mentionsDelta: number;
}
async function getPulse(rows: LabRow[]): Promise<Pulse> {
  const db = createServiceClient();
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();
  const since14 = new Date(Date.now() - 14 * DAY).toISOString();
  const [{ count: episodes7d }, { count: episodes14d }, { count: channels }] = await Promise.all([
    db.from("episodes").select("id", { count: "exact", head: true }).gte("published_at", since7),
    db.from("episodes").select("id", { count: "exact", head: true }).gte("published_at", since14).lt("published_at", since7),
    db.from("channels").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const { data: durs } = await db
    .from("episodes").select("duration_sec").gte("published_at", since7).not("duration_sec", "is", null)
    .limit(5000);
  const hours7d = Math.round((durs || []).reduce((s, d: any) => s + (d.duration_sec || 0), 0) / 3600);
  const m7 = inWindow(rows, 7).length, m14 = inWindow(rows, 7, 7).length;
  return {
    episodes7d: episodes7d ?? 0, mentions7d: m7, hours7d, channels: channels ?? 0,
    episodesDelta: (episodes7d ?? 0) - (episodes14d ?? 0), mentionsDelta: m7 - m14,
  };
}

// ── #2 Battlefield ──────────────────────────────────────────────────────────
export interface BattlefieldRow { issue: string; leftW: number; rightW: number; total: number }
function getBattlefield(rows: LabRow[]): BattlefieldRow[] {
  const m = new Map<string, { l: number; r: number }>();
  for (const r of inWindow(rows, 7)) {
    const b = m.get(r.issue_name) ?? { l: 0, r: 0 };
    if (r.sent < -0.5) b.l += w(r); else if (r.sent > 0.5) b.r += w(r);
    m.set(r.issue_name, b);
  }
  return [...m.entries()]
    .map(([issue, b]) => ({ issue, leftW: Math.round(b.l), rightW: Math.round(b.r), total: Math.round(b.l + b.r) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total).slice(0, 12);
}

// ── #3 Heat grid ────────────────────────────────────────────────────────────
export interface HeatCell { vol: number; lean: number | null }
export interface HeatRow { issue: string; weeks: HeatCell[] }
function getHeatGrid(rows: LabRow[]): { issues: HeatRow[]; weekLabels: string[] } {
  const NWEEKS = 8;
  const totals = new Map<string, number>();
  for (const r of inWindow(rows, NWEEKS * 7)) totals.set(r.issue_name, (totals.get(r.issue_name) ?? 0) + 1);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n]) => n);
  const weekLabels: string[] = [];
  for (let i = NWEEKS - 1; i >= 0; i--) weekLabels.push(new Date(Date.now() - (i * 7 + 6) * DAY).toISOString().slice(5, 10));
  const issues = top.map((issue) => {
    const weeks: HeatCell[] = [];
    for (let i = NWEEKS - 1; i >= 0; i--) {
      const wr = inWindow(rows, 7, i * 7).filter((r) => r.issue_name === issue);
      const idx = weightedIndex(wr);
      weeks.push({ vol: wr.length, lean: idx });
    }
    return { issue, weeks };
  });
  return { issues, weekLabels };
}

// ── #4 Ownership map ────────────────────────────────────────────────────────
export interface OwnershipPoint { issue: string; topic: string; lean: number; volume: number; weight: number }
function getOwnership(rows: LabRow[]): OwnershipPoint[] {
  const m = new Map<string, { rows: LabRow[]; topic: string }>();
  for (const r of inWindow(rows, 30)) {
    const e = m.get(r.issue_name) ?? { rows: [], topic: r.topic_slug ?? "other" };
    e.rows.push(r); m.set(r.issue_name, e);
  }
  return [...m.entries()]
    .filter(([, e]) => e.rows.length >= 10)
    .map(([issue, e]) => ({
      issue, topic: e.topic,
      lean: weightedIndex(e.rows) ?? 0,
      volume: e.rows.length,
      weight: Math.round(e.rows.reduce((s, r) => s + w(r), 0)),
    }));
}

// ── #5 The Gap ──────────────────────────────────────────────────────────────
export interface GapRow { issue: string; indep: number; legacy: number; gap: number; volume: number }
function getGap(rows: LabRow[]): GapRow[] {
  const m = new Map<string, { i: LabRow[]; l: LabRow[] }>();
  for (const r of inWindow(rows, 30)) {
    const e = m.get(r.issue_name) ?? { i: [], l: [] };
    (r.cohort === "independent" ? e.i : e.l).push(r);
    m.set(r.issue_name, e);
  }
  return [...m.entries()]
    .filter(([, e]) => e.i.length >= 10 && e.l.length >= 10)
    .map(([issue, e]) => {
      const indep = weightedIndex(e.i) ?? 0, legacy = weightedIndex(e.l) ?? 0;
      return { issue, indep, legacy, gap: indep - legacy, volume: e.i.length + e.l.length };
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 12);
}

// ── #6 Two conversations ────────────────────────────────────────────────────
export interface TwoConvPoint { date: string; independent: number | null; legacy: number | null }
function getTwoConversations(rows: LabRow[]): TwoConvPoint[] {
  const out: TwoConvPoint[] = [];
  for (let i = 75; i >= 0; i -= 3) {
    const win = inWindow(rows, 7, i);
    out.push({
      date: new Date(Date.now() - i * DAY).toISOString().slice(0, 10),
      independent: weightedIndex(win.filter((r) => r.cohort === "independent")),
      legacy: weightedIndex(win.filter((r) => r.cohort === "legacy")),
    });
  }
  return out;
}

// ── #7 Risers & faders ──────────────────────────────────────────────────────
export interface RiserRow {
  channel: string; lean: string; cohort: string; reach: number;
  shareNow: number; shareDelta: number; leanShift: number; mentionsNow: number;
}
function getRisers(rows: LabRow[]): RiserRow[] {
  const now = inWindow(rows, 7), prev = inWindow(rows, 7, 7);
  const totNow = now.reduce((s, r) => s + w(r), 0) || 1;
  const totPrev = prev.reduce((s, r) => s + w(r), 0) || 1;
  const chans = new Map<string, { now: LabRow[]; prev: LabRow[] }>();
  for (const r of now) { const e = chans.get(r.ch_name) ?? { now: [], prev: [] }; e.now.push(r); chans.set(r.ch_name, e); }
  for (const r of prev) { const e = chans.get(r.ch_name) ?? { now: [], prev: [] }; e.prev.push(r); chans.set(r.ch_name, e); }
  return [...chans.entries()]
    .filter(([, e]) => e.now.length + e.prev.length >= 8)
    .map(([channel, e]) => {
      const r0 = e.now[0] ?? e.prev[0];
      const sNow = (e.now.reduce((s, r) => s + w(r), 0) / totNow) * 100;
      const sPrev = (e.prev.reduce((s, r) => s + w(r), 0) / totPrev) * 100;
      const lNow = weightedIndex(e.now), lPrev = weightedIndex(e.prev);
      return {
        channel, lean: r0.lean, cohort: r0.cohort, reach: r0.reach,
        shareNow: Number(sNow.toFixed(2)), shareDelta: Number((sNow - sPrev).toFixed(2)),
        leanShift: lNow !== null && lPrev !== null ? Number((lNow - lPrev).toFixed(2)) : 0,
        mentionsNow: e.now.length,
      };
    })
    .sort((a, b) => Math.abs(b.shareDelta) - Math.abs(a.shareDelta)).slice(0, 14);
}

// ── #8 Megaphone treemap ────────────────────────────────────────────────────
export interface MegaphoneNode { name: string; size: number; lean: string; cohort: string; mentions: number }
function getMegaphone(rows: LabRow[]): MegaphoneNode[] {
  const m = new Map<string, { wsum: number; n: number; lean: string; cohort: string }>();
  for (const r of inWindow(rows, 7)) {
    const e = m.get(r.ch_name) ?? { wsum: 0, n: 0, lean: r.lean, cohort: r.cohort };
    e.wsum += w(r); e.n++; m.set(r.ch_name, e);
  }
  return [...m.entries()]
    .map(([name, e]) => ({ name, size: Math.round(e.wsum), lean: e.lean, cohort: e.cohort, mentions: e.n }))
    .sort((a, b) => b.size - a.size).slice(0, 40);
}

// ── #9 Lit fuses ────────────────────────────────────────────────────────────
export interface FuseRow { issue: string; weekly: number[]; ratio: number; firstMover: string }
function getFuses(rows: LabRow[]): FuseRow[] {
  const m = new Map<string, LabRow[][]>();
  for (let i = 0; i < 4; i++) {
    for (const r of inWindow(rows, 7, i * 7)) {
      const arr = m.get(r.issue_name) ?? [[], [], [], []];
      arr[3 - i].push(r); m.set(r.issue_name, arr);
    }
  }
  return [...m.entries()]
    .map(([issue, weeks]) => {
      const weekly = weeks.map((x) => x.length);
      const prevAvg = Math.max((weekly[0] + weekly[1] + weekly[2]) / 3, 3);
      const ratio = weekly[3] / prevAvg;
      const byChan = new Map<string, number>();
      for (const r of weeks[3]) byChan.set(r.ch_name, (byChan.get(r.ch_name) ?? 0) + 1);
      const firstMover = [...byChan.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
      return { issue, weekly, ratio: Number(ratio.toFixed(2)), firstMover };
    })
    .filter((f) => f.weekly[3] >= 10)
    .sort((a, b) => b.ratio - a.ratio).slice(0, 6);
}

// ── #10 Strips ──────────────────────────────────────────────────────────────
export interface Strip { issue: string; points: { date: string; lean: number | null; vol: number }[] }
function getStrips(rows: LabRow[]): Strip[] {
  const win = inWindow(rows, 30);
  const totals = new Map<string, number>();
  for (const r of win) totals.set(r.issue_name, (totals.get(r.issue_name) ?? 0) + 1);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([n]) => n);
  return top.map((issue) => {
    const points: Strip["points"] = [];
    for (let i = 27; i >= 0; i -= 3) {
      const wr = inWindow(rows, 7, i).filter((r) => r.issue_name === issue);
      points.push({ date: new Date(Date.now() - i * DAY).toISOString().slice(5, 10), lean: weightedIndex(wr), vol: wr.length });
    }
    return { issue, points };
  });
}

// ── #11 Receipts ────────────────────────────────────────────────────────────
export interface Receipt { quote: string; sent: number; inten: number; channel: string; lean: string; issue: string; url: string; published: string }
async function getReceipts(): Promise<Receipt[]> {
  const db = createServiceClient();
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const { data, error } = await db
    .from("sentiment_scores")
    .select(
      `sentiment, intensity,
       classification:classifications!sentiment_scores_classification_id_fkey!inner (
         supporting_quote,
         issue:issues!classifications_issue_slug_fkey!inner ( name ),
         episode:episodes!classifications_episode_id_fkey!inner (
           published_at, source_url,
           channel:channels!episodes_channel_id_fkey!inner ( name, political_lean, active )
         )
       )`,
    )
    .eq("classification.episode.channel.active", true)
    .gte("classification.episode.published_at", since)
    .or("sentiment.gte.4,sentiment.lte.-4")
    .gte("intensity", 4)
    .limit(400);
  if (error) throw new Error(`getReceipts: ${error.message}`);
  return (data as any[])
    .map((r) => ({
      quote: r.classification.supporting_quote, sent: Number(r.sentiment), inten: Number(r.intensity),
      channel: r.classification.episode.channel.name, lean: r.classification.episode.channel.political_lean,
      issue: r.classification.issue?.name ?? "", url: r.classification.episode.source_url,
      published: r.classification.episode.published_at,
    }))
    .sort((a, b) => Math.abs(b.sent) * b.inten - Math.abs(a.sent) * a.inten)
    .slice(0, 12);
}

// ── #12 Cross-talk ──────────────────────────────────────────────────────────
const NOTABLES: Record<string, string[]> = {
  "Joe Rogan": ["joe rogan", "rogan"],
  "Tucker Carlson": ["tucker carlson", "tucker"],
  "Ben Shapiro": ["ben shapiro"],
  "Charlie Kirk": ["charlie kirk"],
  "Megyn Kelly": ["megyn kelly"],
  "Dan Bongino": ["bongino"],
  "Glenn Beck": ["glenn beck"],
  "Mark Levin": ["mark levin"],
  "Theo Von": ["theo von"],
  "Lex Fridman": ["lex fridman"],
  "Rachel Maddow": ["maddow"],
  "Sean Hannity": ["hannity"],
  "Candace Owens": ["candace owens"],
  "Matt Walsh": ["matt walsh"],
  "Jordan Peterson": ["jordan peterson"],
  "Bill Maher": ["bill maher", "maher"],
  "Ezra Klein": ["ezra klein"],
  "Bari Weiss": ["bari weiss"],
  "Piers Morgan": ["piers morgan"],
  "Shawn Ryan": ["shawn ryan"],
  "Jon Stewart": ["jon stewart"],
  "Joe Scarborough": ["scarborough"],
  "Gavin Newsom": ["gavin newsom", "newsom"],
  "Pod Save America": ["pod save america"],
  "Breaking Points": ["breaking points"],
  "The Daily Wire": ["daily wire"],
};
export interface CrossTalkRow { who: string; count: number; by: { channel: string; n: number }[] }
async function getCrossTalk(): Promise<CrossTalkRow[]> {
  const db = createServiceClient();
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const quotes: { q: string; ch: string }[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db
      .from("classifications")
      .select(
        `id, supporting_quote,
         episode:episodes!classifications_episode_id_fkey!inner (
           published_at,
           channel:channels!episodes_channel_id_fkey!inner ( name, active )
         )`,
      )
      .eq("episode.channel.active", true)
      .gte("episode.published_at", since)
      .order("id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`getCrossTalk: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      if (r.supporting_quote) quotes.push({ q: r.supporting_quote.toLowerCase(), ch: r.episode.channel.name });
    }
  }
  const counts = new Map<string, Map<string, number>>();
  for (const { q, ch } of quotes) {
    for (const [who, aliases] of Object.entries(NOTABLES)) {
      if (ch.toLowerCase().includes(aliases[aliases.length - 1])) continue; // skip self-mentions
      if (aliases.some((a) => q.includes(a))) {
        const by = counts.get(who) ?? new Map();
        by.set(ch, (by.get(ch) ?? 0) + 1);
        counts.set(who, by);
      }
    }
  }
  return [...counts.entries()]
    .map(([who, by]) => ({
      who,
      count: [...by.values()].reduce((s, n) => s + n, 0),
      by: [...by.entries()].map(([channel, n]) => ({ channel, n })).sort((a, b) => b.n - a.n).slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count).slice(0, 10);
}

// ── #13 Polarization ────────────────────────────────────────────────────────
export interface PolarBin { bin: number; count: number }
function getPolarization(rows: LabRow[]): { bins: PolarBin[]; pctExtreme: number; mentions: number } {
  const win = inWindow(rows, 7);
  const bins = new Map<number, number>();
  let extreme = 0;
  for (const r of win) {
    const b = Math.round(r.sent * 2) / 2;
    bins.set(b, (bins.get(b) ?? 0) + 1);
    if (Math.abs(r.sent) >= 3) extreme++;
  }
  const out: PolarBin[] = [];
  for (let b = -5; b <= 5; b += 0.5) out.push({ bin: b, count: bins.get(Math.round(b * 2) / 2) ?? 0 });
  return { bins: out, pctExtreme: win.length ? Math.round((extreme / win.length) * 100) : 0, mentions: win.length };
}

// ── #14 Audio vs video ──────────────────────────────────────────────────────
export interface PlatformSplitRow { issue: string; podcast: number | null; youtube: number | null; vol: number }
function getPlatformSplit(rows: LabRow[]): PlatformSplitRow[] {
  const m = new Map<string, { p: LabRow[]; y: LabRow[] }>();
  for (const r of inWindow(rows, 30)) {
    const e = m.get(r.issue_name) ?? { p: [], y: [] };
    (r.platform === "podcast" ? e.p : e.y).push(r);
    m.set(r.issue_name, e);
  }
  return [...m.entries()]
    .filter(([, e]) => e.p.length >= 10 && e.y.length >= 10)
    .map(([issue, e]) => ({
      issue,
      podcast: weightedIndex(e.p), youtube: weightedIndex(e.y),
      vol: e.p.length + e.y.length,
    }))
    .sort((a, b) => b.vol - a.vol).slice(0, 8);
}

// ── Assembly ────────────────────────────────────────────────────────────────
export interface HomelabData {
  pulse: Pulse;
  battlefield: BattlefieldRow[];
  heat: { issues: HeatRow[]; weekLabels: string[] };
  ownership: OwnershipPoint[];
  gap: GapRow[];
  twoConv: TwoConvPoint[];
  risers: RiserRow[];
  megaphone: MegaphoneNode[];
  fuses: FuseRow[];
  strips: Strip[];
  receipts: Receipt[];
  crossTalk: CrossTalkRow[];
  polarization: ReturnType<typeof getPolarization>;
  platformSplit: PlatformSplitRow[];
  rowCount: number;
}

export async function getHomelabData(): Promise<HomelabData> {
  const rows = await fetchLabRows(90);
  const [pulse, receipts, crossTalk] = await Promise.all([getPulse(rows), getReceipts(), getCrossTalk()]);
  return {
    pulse,
    battlefield: getBattlefield(rows),
    heat: getHeatGrid(rows),
    ownership: getOwnership(rows),
    gap: getGap(rows),
    twoConv: getTwoConversations(rows),
    risers: getRisers(rows),
    megaphone: getMegaphone(rows),
    fuses: getFuses(rows),
    strips: getStrips(rows),
    receipts,
    crossTalk,
    polarization: getPolarization(rows),
    platformSplit: getPlatformSplit(rows),
    rowCount: rows.length,
  };
}
