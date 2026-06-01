/**
 * Channel cohorts. Soapbox tracks the YouTube + podcast *platform*; within it,
 * channels are one of two *cohorts*:
 *   - "independent" — creator / digital-native outlets
 *   - "legacy"      — traditional institutions' presence on the platform
 *
 * `PUBLIC_COHORTS` is the single control point for what the public site shows.
 * Until the independent-vs-legacy comparison UX ships, the master is
 * independent-only — so legacy channels can be seeded and ingested invisibly.
 * Launch = extend this to ["independent", "legacy"] (blended master) and add
 * the per-cohort sub-needle reads.
 */
export type Cohort = "independent" | "legacy";

export const PUBLIC_COHORTS: readonly Cohort[] = ["independent", "legacy"];
