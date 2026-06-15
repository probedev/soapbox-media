/**
 * Single source of truth for the site's L/R lean + sentiment formatting and the
 * red (= Right) / blue (= Left) color convention - the product's signature
 * visual language. These were previously copy-pasted as formatLean / leanColor /
 * sentimentChip / leanChip across ~10 files; consolidated here so the threshold,
 * labels, and palette can never drift. Presentational wrappers (SentimentChip,
 * LeanChip, IntensityMeter) live in src/components/Lean.tsx.
 */

/** Below this absolute aggregate-lean magnitude we render "neutral", not L/R. */
export const LEAN_NEUTRAL_BAND = 0.05;

/** Numeric aggregate lean (negative = Left, positive = Right) as an L+/R+ label. */
export function formatLean(v: number, neutralLabel = "0.0"): string {
  if (v > LEAN_NEUTRAL_BAND) return `R+${v.toFixed(1)}`;
  if (v < -LEAN_NEUTRAL_BAND) return `L+${Math.abs(v).toFixed(1)}`;
  return neutralLabel;
}

/** Text color for a numeric aggregate lean (red = Right, blue = Left). */
export function leanColor(v: number, neutralClass = "text-ink-body"): string {
  if (v > LEAN_NEUTRAL_BAND) return "text-red-600";
  if (v < -LEAN_NEUTRAL_BAND) return "text-blue-600";
  return neutralClass;
}

/**
 * Badge text + bg/text classes for a per-mention sentiment chip. Note: sentiment
 * chips flip at exactly 0 (any nonzero shows L+/R+), unlike the aggregate-lean
 * neutral band above. `null` = unscored.
 */
export function sentimentChipStyle(sentiment: number | null): { text: string; cls: string } {
  if (sentiment == null) return { text: "unscored", cls: "bg-muted text-muted-foreground" };
  if (sentiment > 0) return { text: `R+${sentiment.toFixed(1)}`, cls: "bg-red-100 text-red-800" };
  if (sentiment < 0) return { text: `L+${Math.abs(sentiment).toFixed(1)}`, cls: "bg-blue-100 text-blue-800" };
  return { text: "0.0", cls: "bg-muted text-ink-muted" };
}

/** Badge text + classes for a categorical L / R / M (Middle) lean chip. */
export function leanChipStyle(lean: string): { text: string; cls: string } {
  if (lean === "L") return { text: "L", cls: "bg-blue-100 text-blue-800" };
  if (lean === "R") return { text: "R", cls: "bg-red-100 text-red-800" };
  return { text: "M", cls: "bg-muted text-ink-body" };
}
