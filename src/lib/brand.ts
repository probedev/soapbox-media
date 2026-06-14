/**
 * Canonical brand copy. Single source of truth so the page title, social
 * cards, footer, and home hero never drift apart (mirrors version.ts for
 * VERSION). Change a line here and every surface updates.
 *
 * Style: no em dashes anywhere (project rule); descriptions stay number-free
 * so they never go stale as the panel grows.
 */

/** Page <title>, OG title, Twitter title, and OG-image alt. The label form
 *  (no trailing verb) so it never truncates in search results. */
export const SITE_TITLE =
  "Soapbox · Voice, reach, and influence in political media";

/** The full positioning line, with verb. Used on the home hero and the OG
 *  social card (the two big visual statements). */
export const TAGLINE =
  "Voice, reach, and influence in political media, measured.";

/** Lowercase label variant for the terse footer lockup. */
export const TAGLINE_FOOTER = "voice, reach, and influence in political media";

/** Evergreen meta description (no live numbers, so it never goes stale). */
export const META_DESCRIPTION =
  "Soapbox measures the voice, reach, and influence of political media on YouTube and podcasts: what independent creators and legacy institutions say about US policy issues, scored on one left/right scale. Updated daily.";
