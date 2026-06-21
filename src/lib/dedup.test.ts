import { describe, it, expect } from "vitest";
import { dedupKey, normalizeTitle, siblingPlatformsOutranking } from "./dedup";

// Cross-platform dedup is directional: for a show on both platforms, a shared
// episode (same title + date) is kept on YouTube and skipped on the podcast.
// These lock that priority and the key normalization. Changing them is a
// deliberate product decision (which platform "owns" a shared episode), not a
// silent one.

describe("siblingPlatformsOutranking (YouTube wins shared episodes)", () => {
  it("YouTube defers to no one (never skipped by a sibling)", () => {
    expect(siblingPlatformsOutranking("youtube")).toEqual([]);
  });

  it("podcast defers to YouTube", () => {
    expect(siblingPlatformsOutranking("podcast")).toEqual(["youtube"]);
  });

  it("unknown platform defers to both ranked platforms", () => {
    expect(siblingPlatformsOutranking("rss").sort()).toEqual(["podcast", "youtube"]);
  });
});

describe("dedupKey / normalizeTitle", () => {
  it("normalizes title to lowercase alphanumerics", () => {
    expect(normalizeTitle("The FULL Interview!  (Ep. 12)")).toBe("thefullinterviewep12");
  });

  it("keys collapse to title + ISO date (ignoring time of day)", () => {
    const a = dedupKey("Same Title", "2026-06-19T17:00:00+00:00");
    const b = dedupKey("same title", "2026-06-19T23:30:00+00:00");
    expect(a).toBe(b);
    expect(a).toBe("sametitle|2026-06-19");
  });
});
