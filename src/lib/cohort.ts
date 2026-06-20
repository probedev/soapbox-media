/**
 * Channel cohorts. Soapbox tracks the YouTube + podcast *platform*; within it,
 * channels are one of two *cohorts*:
 *   - "independent" - creator / digital-native outlets
 *   - "legacy"      - traditional institutions' presence on the platform
 *
 * `PUBLIC_COHORTS` is the single control point for what the public site shows.
 * The headline (aggregate) needle blends both cohorts; the home page also shows
 * an independent and a legacy sub-needle, each on its own (the three-needle
 * design). This is the master set every public aggregate reads - keep copy in
 * sync with it (the Index is NOT independent-only).
 */
export type Cohort = "independent" | "legacy";

export const PUBLIC_COHORTS: readonly Cohort[] = ["independent", "legacy"];
