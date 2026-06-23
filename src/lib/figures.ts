/**
 * Public Figures: pure detection helpers. Build whole-word alias matchers and
 * extract favorability-candidate windows from a transcript. No DB and no LLM
 * here (see scripts/detect-figures.ts for the driver and src/modules/score for
 * the scoring pass) - this mirrors the "pure + unit-tested" split of
 * transcript-timing.ts / scoring.ts.
 *
 * Why windows, not the whole transcript: favorability is scored per mention.
 * Why a cheap ad-read filter: figures are often named only as a market
 * reference in a sponsor read ("...as Elon made his second trillion, invest in
 * Advantage Gold"), which is noise, not a stance. The intensity scale (1 =
 * passing mention) is the secondary gate, applied at aggregation.
 */

export interface FigureMatcher {
  slug: string;
  regex: RegExp;
}

export interface DetectedWindow {
  figureSlug: string;
  charOffset: number;
  quote: string;
  matchedAlias: string;
  startTs: number | null;
}

/**
 * Whole-word, case-insensitive matcher for any of a figure's aliases. Longest
 * aliases first so "elon musk" wins over "elon". Word boundaries are mandatory:
 * a substring match would catch "bELONgs"/"fELONy" (the bug that inflated the
 * first Elon count 773 -> 441).
 */
export function buildAliasRegex(aliases: string[]): RegExp {
  const esc = aliases
    .filter(Boolean)
    .map((a) => a.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  if (esc.length === 0) return /a^/; // matches nothing
  return new RegExp(`\\b(${esc.join("|")})\\b`, "gi");
}

const TS_MARKER = /\[(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*-->/g;

/**
 * Seconds of the last "[HH:MM:SS -->" caption marker at or before `offset`.
 * YouTube transcripts (Supadata) embed these inline in the text, giving us a
 * deep-link timestamp for free; podcasts usually have none -> null.
 */
export function startTsBefore(text: string, offset: number): number | null {
  TS_MARKER.lastIndex = 0;
  let last: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = TS_MARKER.exec(text)) !== null) {
    if (m.index > offset) break;
    last = +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  return last;
}

/** Strip caption timestamp markers and collapse whitespace for a clean excerpt. */
export function cleanQuote(s: string): string {
  return s
    .replace(/\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*-->\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AD_MARKERS =
  /\b(promo code|use code|use the code|coupon|advantage gold|policygenius|sponsored by|brought to you by|this episode is sponsored|\d{1,3}% off|go to [a-z0-9.-]+\.com)\b/i;

/** Cheap pre-filter: a clear sponsor/ad-read window names a figure only as a
 *  market reference, not a stance - drop it before scoring. */
export function isAdRead(quote: string): boolean {
  return AD_MARKERS.test(quote);
}

export interface ExtractOpts {
  /** Chars each side of the matched name. */
  radius?: number;
  /** Collapse same-figure matches closer together than this (one window). */
  mergeWithin?: number;
  /** Cap windows per figure per transcript, to bound scoring cost on an
   *  episode that is entirely about one figure. */
  maxPerFigure?: number;
}

/**
 * Extract favorability-candidate windows for each figure from a transcript.
 * Deduplicates nearby mentions, drops ad-reads and tiny fragments, and caps
 * per-figure volume. Pure: deterministic given the same inputs.
 */
export function extractWindows(
  text: string,
  matchers: FigureMatcher[],
  opts: ExtractOpts = {},
): DetectedWindow[] {
  const radius = opts.radius ?? 320;
  const mergeWithin = opts.mergeWithin ?? 240;
  const maxPerFigure = opts.maxPerFigure ?? 6;
  const out: DetectedWindow[] = [];
  for (const fig of matchers) {
    fig.regex.lastIndex = 0;
    let last = -Infinity;
    let kept = 0;
    let m: RegExpExecArray | null;
    while ((m = fig.regex.exec(text)) !== null) {
      if (kept >= maxPerFigure) break;
      const off = m.index;
      if (off - last < mergeWithin) continue;
      last = off;
      const quote = cleanQuote(text.slice(Math.max(0, off - radius), off + radius));
      if (quote.length < 40 || isAdRead(quote)) continue;
      out.push({
        figureSlug: fig.slug,
        charOffset: off,
        quote,
        matchedAlias: m[1].toLowerCase(),
        startTs: startTsBefore(text, off),
      });
      kept += 1;
    }
  }
  return out;
}
