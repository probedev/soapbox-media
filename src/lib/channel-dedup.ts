/**
 * Channel-level dedup - the single home for "is this candidate already in the
 * panel?". It replaces the four scattered name-normalizers that each discovery
 * and seed script reimplemented (discover-podcasts, seed-expansion, recover-
 * feeds, plus dedup.ts's episode-title normalizer), which drifted apart.
 *
 * Two callers share ONE matcher:
 *   - `channels discover` - skip candidates already tracked (set status
 *     'duplicate').
 *   - `channels prune` - find same-platform duplicate ROWS in the live table.
 *
 * Pure + dependency-light (no next/server, no db) so it is unit-testable and
 * importable anywhere. Cross-platform aware: a same-name row on the OTHER
 * platform is a *sibling* (a show legitimately tracked on both YouTube and a
 * podcast feed, by design two rows), not a duplicate - the caller decides via
 * `samePlatform`.
 */

export type Platform = "youtube" | "podcast";

export interface ChannelLike {
  name: string;
  platform: Platform;
  platform_id?: string | null;
}

export interface MatchResult<T> {
  /** The existing channel this candidate collides with, or null. */
  match: T | null;
  /** Why it matched: exact provider id, or anchor-gated name. */
  reason: "platform_id" | "name" | null;
  /** True only when the match is on the SAME platform (a real duplicate). A
   *  cross-platform match is a sibling, not a reject. */
  samePlatform: boolean;
}

/** Lowercase, strip every non-alphanumeric. The canonical name normalizer. */
export function normalizeName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Generic show-name words that carry no identity - stripped before picking the
// distinctive anchor token so "The Daily Show" anchors on "daily", not "show".
const STOPWORDS = new Set([
  "the", "show", "podcast", "pod", "with", "and", "a", "an", "of", "on", "in",
  "at", "to", "for", "report", "daily", "news", "live", "radio", "program",
  "hour", "uncensored", "official", "tv",
]);

/**
 * The longest distinctive (non-stopword) token in a name, lowercased. Used as a
 * false-positive guard for fuzzy contains-matching: "Ben Shapiro" (anchor
 * "shapiro") matches "The Ben Shapiro Show", but "Pod Save the People" (anchor
 * "people") does NOT match "Pod Save the World". Returns "" when a name is all
 * stopwords (then only exact normalized equality can match it).
 */
export function anchor(name: string): string {
  const toks = (name || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));
  let best = "";
  for (const t of toks) if (t.length > best.length) best = t;
  return best;
}

const MIN_SUBSTR = 5;

function tokenCount(s: string): number {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).length;
}

/**
 * Do two channel names refer to the same show? Exact normalized equality, or
 * the shorter name is FULLY contained in the longer one. Full-substring (not
 * shared-token) is the key precision win: it matches "Ben Shapiro" in "The Ben
 * Shapiro Show" but NOT "David Frum" vs "David Pakman" or "Glenn Beck" vs "Glenn
 * Greenwald" (which share only a generic first name). The shorter side must be
 * >= 5 chars and either multi-word OR >= 7 chars, so a short generic single
 * token ("Today", "Pivot") cannot collide with an unrelated longer name. This
 * biases to precision: a missed sibling resurfaces for human review; a false
 * match would silently drop a real new show.
 */
export function nameMatches(a: string, b: string): boolean {
  const an = normalizeName(a);
  const bn = normalizeName(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  const aShorter = an.length <= bn.length;
  const short = aShorter ? an : bn;
  const long = aShorter ? bn : an;
  const shortTokens = tokenCount(aShorter ? a : b);
  if (short.length >= MIN_SUBSTR && long.includes(short) && (shortTokens >= 2 || short.length >= 7)) {
    return true;
  }
  return false;
}

/**
 * Find the existing channel a candidate collides with. Prefers an exact
 * provider-id match on the same platform (the strongest signal), then falls
 * back to anchor-gated name matching. Returns the first match.
 */
export function matchChannel<T extends ChannelLike>(
  candidate: ChannelLike,
  existing: T[],
): MatchResult<T> {
  if (candidate.platform_id) {
    const byId = existing.find(
      (e) =>
        e.platform === candidate.platform &&
        !!e.platform_id &&
        e.platform_id === candidate.platform_id,
    );
    if (byId) return { match: byId, reason: "platform_id", samePlatform: true };
  }
  const byName = existing.find((e) => nameMatches(candidate.name, e.name));
  if (byName) {
    return {
      match: byName,
      reason: "name",
      samePlatform: byName.platform === candidate.platform,
    };
  }
  return { match: null, reason: null, samePlatform: false };
}
