/**
 * Resolve a classifier supporting_quote back to a start timestamp in the source
 * media, using the timestamped transcript segments we keep for YouTube captions
 * (transcripts.segments). Pure + deterministic - no LLM, no network - so it has
 * a unit test (transcript-timing.test.ts) and lives here, not inlined.
 *
 * Why prefix-matching, not full-quote matching: the model's "verbatim" quote is
 * reliable at the START but drifts later (it cleans up filler and stitches
 * non-adjacent clauses). Empirically (2026-06-20 probe over ~800 mentions) a
 * full-quote match lands ~35% of the time; matching a short, punctuation-stripped
 * prefix lands ~85%. A timestamp only needs the quote's start, so we anchor on the
 * longest prefix that occurs, requiring uniqueness for the short prefixes to avoid
 * placing the marker on the wrong occurrence of a common opening phrase. A miss
 * returns null and the mention simply renders without a timestamp.
 */

/** One timestamped transcript chunk: `t` = start seconds, `x` = chunk text. */
export type TranscriptSegment = { t: number; x: string };

/** Lowercase, strip every non-alphanumeric run to a single space. Auto-captions
 *  are inconsistently punctuated/cased, so we compare on this normalized form. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** start seconds of the segment covering normalized-char position `pos`. */
function timeAtPos(anchors: { pos: number; t: number }[], pos: number): number {
  // anchors are sorted ascending by pos; find the last anchor with pos <= target.
  let lo = 0;
  let hi = anchors.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].pos <= pos) {
      ans = anchors[mid].t;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Best-effort start time (whole seconds) for `quote` within `segments`, or null
 * if it can't be located confidently or no segments exist.
 */
export function quoteStartSeconds(
  quote: string | null | undefined,
  segments: TranscriptSegment[] | null | undefined,
): number | null {
  if (!quote || !segments || segments.length === 0) return null;
  const nq = normalize(quote);
  if (nq.length < 16) return null; // too short to anchor reliably

  // Build the normalized transcript and a position -> start-time index.
  let full = "";
  const anchors: { pos: number; t: number }[] = [];
  for (const seg of segments) {
    const nx = normalize(seg?.x ?? "");
    if (!nx) continue;
    anchors.push({ pos: full.length, t: Math.max(0, Math.floor(Number(seg.t) || 0)) });
    full += nx + " ";
  }
  if (!full || anchors.length === 0) return null;

  // Long prefixes are trusted at their first occurrence; short prefixes only
  // when unique. Ordered long -> short so we anchor as specifically as possible.
  const tiers: { len: number; requireUnique: boolean }[] = [
    { len: 80, requireUnique: false },
    { len: 56, requireUnique: false },
    { len: 40, requireUnique: false },
    { len: 28, requireUnique: true },
  ];
  for (const { len, requireUnique } of tiers) {
    if (nq.length < len) continue;
    const pre = nq.slice(0, len);
    const idx = full.indexOf(pre);
    if (idx === -1) continue;
    if (requireUnique && full.indexOf(pre, idx + 1) !== -1) continue;
    return timeAtPos(anchors, idx);
  }

  // Short quotes (below the shortest prefix tier, e.g. a terse 16-27 char
  // quote) won't hit any tier above; match the whole normalized quote when it
  // occurs exactly once. The uniqueness guard preserves precision. (Real quotes
  // are 80-300 chars, so this is a safety net, not the common path.)
  const whole = full.indexOf(nq);
  if (whole !== -1 && full.indexOf(nq, whole + 1) === -1) {
    return timeAtPos(anchors, whole);
  }
  return null;
}

/** `mm:ss` (or `h:mm:ss` past an hour) for a whole-second offset. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}

/**
 * Append `&t=<seconds>s` to a YouTube watch/youtu.be URL so the player opens at
 * the mention. Returns the URL unchanged for non-YouTube sources (podcasts have
 * no universal timestamp deep-link) or when there's no timestamp.
 */
export function timestampedSourceUrl(
  sourceUrl: string,
  startTs: number | null | undefined,
): string {
  if (!sourceUrl || startTs == null || startTs <= 0) return sourceUrl;
  if (!/(?:youtube\.com\/watch|youtu\.be\/)/.test(sourceUrl)) return sourceUrl;
  const s = Math.floor(startTs);
  // Drop any existing t= param, then re-append, to avoid a stale duplicate.
  const cleaned = sourceUrl.replace(/([?&])t=\d+s?(&|$)/, "$1").replace(/[?&]$/, "");
  const sep = cleaned.includes("?") ? "&" : "?";
  return `${cleaned}${sep}t=${s}s`;
}
