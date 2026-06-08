/**
 * Trending Names - a BETA home-page tease. Detects named entities (people,
 * orgs, places) surging across the tracked panel this week and links back to
 * the shows discussing them. Validated via scripts/probe-entity-burst.ts; the
 * known-imperfect parts (ASR-misspelling fragmentation, scoring) are mitigated
 * here with edit-distance variant merging + breadth gating, and the surface is
 * labelled experimental.
 *
 * Extraction is cheap & deterministic (no LLM/model): relies on the confirmed
 * reliable Title-Case in our transcripts. One 21-day pass:
 *   - recent  = last 7 days  → mentions + per-channel + daily sparkline
 *   - baseline = days 8–21   → the rate to burst against
 * An entity qualifies if it's broad (≥ MIN_CHANNELS shows) AND rising
 * (burst ≥ MIN_BURST). Ranked by breadth - "how many shows picked it up" - the
 * signal that the panel converged on something.
 *
 * Persisted to dashboard_snapshot (key `trending_v1`), refreshed daily by
 * /api/cron/trending. Read-only against transcripts.
 */
import { createServiceClient } from "@/lib/db";

const DAY = 86_400_000;
const RECENT_DAYS = 7;
const BASELINE_DAYS = 14; // days 8..21
const SPARK_DAYS = 14;
const MIN_CHANNELS = 8; // cross-panel breadth floor
const MIN_MENTIONS = 40; // volume floor - kills niche 15-mention spikes
// Burst floor raised 1.4 → 1.7 (2026-06-08): excludes omnipresent institutions
// (NYT, CNN, Trump) that are cited every week at ~1.5× - broad but not actually
// trending. We rank by BREADTH among entities that clear this floor: breadth
// ranking implicitly suppresses the extraction noise floor (ASR fragments /
// common-word leaks rarely reach wide breadth), while the burst floor strips
// the perennials. Burst ranking was tried and rejected - it surfaced the junk.
const MIN_BURST = 1.7;
const MAX_ENTITIES = 12;

// Major media outlets are cited across the whole panel every week, so their
// baseline is structurally huge and a normal burst floor lets them headline
// "trending" on ubiquity (NYT topped the list at only 1.9×). Require them to
// REALLY spike (2.5×) to qualify - a media org genuinely becoming the story.
const MEDIA_FLOOR = 2.5;
const MEDIA_ORGS = new Set(
  ("new york times,the new york times,washington post,the washington post,wall street journal," +
   "cnn,fox news,msnbc,nbc news,cbs news,abc news,npr,pbs,bbc,bbc news,reuters,associated press," +
   "bloomberg,bloomberg television,politico,axios,the atlantic,the economist,vox,vice,newsmax," +
   "the hill,the daily wire,daily wire,new york post,los angeles times,usa today,the guardian," +
   "breitbart,huffpost,the daily beast,cnbc,fox business,real clear politics").split(","));
const SNAPSHOT_KEY = "trending_v1";

// Sentence-initial caps / filler that aren't entities. Trimmed from run edges
// and dropped as standalone tokens.
const COMMON = new Set(
  ("the a an and but or so if then because also just really actually right well yeah yes no ok okay look " +
   "listen welcome thanks thank hello hi this that these those there here now today tomorrow yesterday we you " +
   "he she they it i what when where who how why our your my his her their let lets here's there's that's what's " +
   "first second next last one two three more most some all every any good great big old people thing things " +
   "way time day week year going get got go come came say said see know think want need make made take back over " +
   "down up out about like mr mrs ms dr sir madam in on at by for of to with from as than too very " +
   "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august " +
   "september october november december god lord guaranteed human fake screw blood heart financial " +
   "democrats republicans democrat republican america american " +
   // backstop: common sentence-leading words that are never entities
   "are would can could should will shall may might must has have had been being am is was were do does " +
   "did done having into your you've i've i'm we've don't can't won't didn't doesn't isn't aren't " +
   "well so but and or because since while though although however therefore thus hence meanwhile " +
   "maybe perhaps probably certainly obviously clearly basically literally honestly frankly").split(/\s+/));

const CONNECTORS = new Set(["of", "the", "and", "for", "de", "von", "la", "del", "da", "&"]);

// Applied ONLY to single-token final entities at selection (NOT edge-trimming,
// so "South Carolina"/"North Korea" stay intact while bare "South" is dropped).
// A comprehensive common-word stopset is the standard fix for sentence-initial
// capitalization leaking into proper-noun extraction.
const SINGLE_BLOCK = new Set(
  ("after before during since until unless while although though however therefore thus hence meanwhile " +
   "please sorry thanks thank welcome hello hey okay yeah yep nope sure alright again also anyway besides " +
   "south north east west left right up down here there everywhere nowhere somewhere anywhere " +
   "really actually basically literally honestly frankly obviously clearly certainly definitely absolutely " +
   "maybe perhaps probably possibly usually generally typically normally suddenly finally eventually " +
   "everybody everyone somebody someone anybody anyone nobody nothing something anything everything " +
   "today tonight tomorrow yesterday now then soon later always never often sometimes once twice " +
   "because so but and or plus minus versus unless whereas otherwise instead however moreover furthermore " +
   "it'll he'll she'll they'll we'll you'll i'll that'll there'll who'll what'll it'd he'd she'd they'd " +
   "we'd you'd i'd here's there's let's gonna wanna gotta kinda sorta dunno " +
   "look listen remember imagine consider notice understand mean guess suppose wonder " +
   "great good big small huge tiny massive amazing incredible terrible awful crazy wild nuts insane " +
   "another other others several various certain particular specific general overall total whole entire " +
   "yes no nope yep yeah uh um hmm wow oh ah eh ok new many much quote unquote nazi nazis " +
   "minutes legal talks lane seconds hours days weeks months years moments times learn " +
   // common verbs/nouns that lead sentences and aren't entities
   "bring start stop keep let put move turn show tell ask call try come go get give take make made " +
   "women men kids children guys folks people money power world country state nation government congress " +
   "war peace media news story point question issue problem reason way thing stuff lot lots " +
   "everything anything nothing something everyone someone anyone nobody " +
   // bare common first names - the full "Scott Jennings" survives (multi-token);
   // lone "Scott" is an ambiguous fragment, so drop it
   "scott mike michael john james david dave chris mark paul steve steven tom thomas dan dann joe joseph " +
   "bill bob robert rick richard jim jimmy tony tim kevin brian gary jeff jeffrey greg craig sam ben " +
   "matt nick pete pat andrew andy ron ronald don donald ed edward frank larry jerry terry " +
   "mary lisa susan karen nancy linda donna carol sandra sarah jess jessica amy emily kate katie " +
   "jen jennifer laura megan rachel hannah").split(/\s+/));

const isCap = (t: string) =>
  /^[A-Z][a-z]+/.test(t) || /^[A-Z]{2,5}$/.test(t) || /^[A-Z][a-z]*[A-Z][a-z]+$/.test(t);

const stripTok = (t: string) =>
  t.replace(/^[^A-Za-z0-9&]+/, "").replace(/['’]s$/, "").replace(/[^A-Za-z0-9&]+$/, "");

/** Maximal Title-Case runs from one document → entity → {count, starts}.
 *  `starts` = occurrences that began a sentence (used to drop common words
 *  that are only ever capitalized because they lead a sentence). */
function extractEntities(text: string): Map<string, { count: number; starts: number }> {
  const out = new Map<string, { count: number; starts: number }>();
  // Strip [timestamp]/[SPEAKER] tags to a PERIOD, not a space: each caption
  // segment starts capitalized regardless of punctuation, so segment
  // boundaries are effectively sentence boundaries for start-ratio purposes.
  const raw = text.replace(/\[[^\]]*\]/g, " . ").replace(/\s+/g, " ").split(/\s+/);
  let i = 0;
  let prevEnder = true;
  while (i < raw.length) {
    const bare = stripTok(raw[i]);
    const endsSentence = /[.!?]/.test(raw[i]);
    if (!bare || !isCap(bare)) { prevEnder = endsSentence; i++; continue; }
    const run: string[] = [bare];
    let j = i + 1;
    const sentenceStart = prevEnder;
    while (j < raw.length) {
      const nb = stripTok(raw[j]);
      if (isCap(nb)) { run.push(nb); j++; continue; }
      if (CONNECTORS.has(nb.toLowerCase())) {
        const after = stripTok(raw[j + 1] ?? "");
        if (after && isCap(after)) { run.push(nb.toLowerCase()); j++; continue; }
      }
      break;
    }
    // trim common/connector edges (both ends - fixes "maine so", "in america")
    while (run.length && (CONNECTORS.has(run[run.length - 1].toLowerCase()) || COMMON.has(run[run.length - 1].toLowerCase()))) run.pop();
    while (run.length && COMMON.has(run[0].toLowerCase())) run.shift();

    let keep = run;
    if (keep.length === 1) {
      const only = keep[0].toLowerCase();
      if (COMMON.has(only) || only.length < 3 || (sentenceStart && /^[a-z]+$/.test(only) === false && only.length < 4)) keep = [];
    } else if (keep.every((t) => COMMON.has(t.toLowerCase()))) {
      keep = [];
    }
    if (keep.length) {
      const key = keep.join(" ").toLowerCase();
      const e = out.get(key) ?? { count: 0, starts: 0 };
      e.count += 1;
      if (sentenceStart) e.starts += 1;
      out.set(key, e);
    }
    prevEnder = /[.!?]/.test(raw[j - 1] ?? "");
    i = j;
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

interface Acc { mentions: number; baseMentions: number; occ: number; starts: number; channels: Map<string, { name: string; count: number }>; spark: number[] }

export interface TrendingEntity {
  name: string;
  channels: number;
  recentMentions: number;
  burst: number;
  spark: number[];
  topChannels: { id: string; name: string; count: number }[];
}
export interface TrendingPayload {
  computedAt: string;
  windowDays: number;
  entities: TrendingEntity[];
}

export async function computeTrending(): Promise<TrendingPayload> {
  const db = createServiceClient();
  const now = Date.now();
  const start = new Date(now - (RECENT_DAYS + BASELINE_DAYS) * DAY).toISOString();
  const recentCut = now - RECENT_DAYS * DAY;

  const acc = new Map<string, Acc>();
  const pageSize = 200;
  for (let page = 0; page < 200; page++) {
    const { data, error } = await db
      .from("transcripts")
      .select(
        `episode_id, text,
         episode:episodes!transcripts_episode_id_fkey!inner (
           published_at,
           channel:channels!episodes_channel_id_fkey!inner ( id, name, active )
         )`,
      )
      .eq("episode.channel.active", true)
      .gte("episode.published_at", start)
      .order("episode_id", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`computeTrending: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      if (!r.text) continue;
      const ts = Date.parse(r.episode.published_at);
      const isRecent = ts >= recentCut;
      const dayIdx = SPARK_DAYS - 1 - Math.floor((now - ts) / DAY);
      const chId = r.episode.channel.id as string;
      const chName = r.episode.channel.name as string;
      for (const [e, { count: c, starts: s }] of extractEntities(r.text)) {
        if (chName.toLowerCase().includes(e)) continue; // self-mention
        let a = acc.get(e);
        if (!a) { a = { mentions: 0, baseMentions: 0, occ: 0, starts: 0, channels: new Map(), spark: new Array(SPARK_DAYS).fill(0) }; acc.set(e, a); }
        a.occ += c; a.starts += s;
        if (isRecent) {
          a.mentions += c;
          const ch = a.channels.get(chId) ?? { name: chName, count: 0 };
          ch.count += c; a.channels.set(chId, ch);
        } else {
          a.baseMentions += c;
        }
        if (dayIdx >= 0 && dayIdx < SPARK_DAYS) a.spark[dayIdx] += c;
      }
    }
  }

  // Merge ASR/alias variants: fold a candidate into an existing canonical when
  // it's the surname of a multi-token canonical, or within edit-distance 2 of
  // its last token. Process by recent breadth desc so canonical = the variant
  // the most shows used.
  const ranked = [...acc.entries()]
    .filter(([, a]) => a.channels.size >= 3)
    .sort((x, y) => y[1].channels.size - x[1].channels.size);

  const canon: { key: string; lastTok: string; acc: Acc }[] = [];
  for (const [key, a] of ranked) {
    const toks = key.split(" ");
    const last = toks[toks.length - 1];
    let merged = false;
    for (const c of canon) {
      const cToks = c.key.split(" ");
      const sameSurname =
        last === c.lastTok ||
        (last.length >= 5 && c.lastTok.length >= 5 && levenshtein(last, c.lastTok) <= 2) ||
        (toks.length === 1 && cToks.includes(last)) ||
        (cToks.length === 1 && toks.includes(c.lastTok));
      if (sameSurname) {
        c.acc.mentions += a.mentions;
        c.acc.baseMentions += a.baseMentions;
        c.acc.occ += a.occ; c.acc.starts += a.starts;
        for (let i = 0; i < SPARK_DAYS; i++) c.acc.spark[i] += a.spark[i];
        for (const [id, ch] of a.channels) {
          const ex = c.acc.channels.get(id);
          if (ex) ex.count += ch.count; else c.acc.channels.set(id, ch);
        }
        merged = true;
        break;
      }
    }
    if (!merged) canon.push({ key, lastTok: last, acc: a });
  }

  const entities: TrendingEntity[] = canon
    // Drop names that are only ever capitalized because they lead a sentence
    // ("Are", "Would", "After"). A real proper noun appears mid-sentence too,
    // so its sentence-initial ratio is low; pure sentence-starters approach 1.
    // Multi-token names are exempt (already edge-trimmed of common words).
    .filter((c) => {
      if (c.key.includes(" ")) return true; // multi-token names are exempt
      if (SINGLE_BLOCK.has(c.key)) return false; // common-word stoplist
      return c.acc.occ < 8 || c.acc.starts / c.acc.occ < 0.7; // sentence-starter ratio
    })
    .map((c) => {
      const channels = c.acc.channels.size;
      const burst = (c.acc.mentions / RECENT_DAYS) / (c.acc.baseMentions / BASELINE_DAYS + 0.2);
      const topChannels = [...c.acc.channels.entries()]
        .map(([id, ch]) => ({ id, name: ch.name, count: ch.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);
      return {
        name: c.key.replace(/\b\w/g, (m) => m.toUpperCase()),
        channels, recentMentions: c.acc.mentions, burst: Number(burst.toFixed(1)),
        spark: c.acc.spark, topChannels,
      };
    })
    .filter((e) => {
      if (e.channels < MIN_CHANNELS || e.recentMentions < MIN_MENTIONS) return false;
      const floor = MEDIA_ORGS.has(e.name.toLowerCase()) ? MEDIA_FLOOR : MIN_BURST;
      return e.burst >= floor;
    })
    // Rank by breadth (burst tiebreak) among entities that cleared the rising
    // floor - clean (junk lacks breadth) and not perennial-dominated (floor
    // strips NYT-likes). Fresh breakouts (Welker) still lag a day under 1×/day
    // ingest as reaction accumulates - an accepted property, not a bug.
    .sort((a, b) => b.channels - a.channels || b.burst - a.burst)
    .slice(0, MAX_ENTITIES);

  return { computedAt: new Date(now).toISOString(), windowDays: RECENT_DAYS, entities };
}

export async function writeTrending(): Promise<TrendingPayload> {
  const payload = await computeTrending();
  const db = createServiceClient();
  const { error } = await db.from("dashboard_snapshot").upsert(
    { key: SNAPSHOT_KEY, payload, computed_at: payload.computedAt },
    { onConflict: "key" },
  );
  if (error) throw new Error(`writeTrending: ${error.message}`);
  return payload;
}

export async function readTrending(): Promise<TrendingPayload | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("dashboard_snapshot").select("payload").eq("key", SNAPSHOT_KEY).maybeSingle();
  if (error) throw new Error(`readTrending: ${error.message}`);
  return (data?.payload as TrendingPayload) ?? null;
}
