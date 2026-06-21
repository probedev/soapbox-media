import { describe, it, expect } from "vitest";
import { videoIdFromUrl, ageHours } from "./metrics";

// Pure helpers behind the Phase-0 view-count snapshots. These map an episode's
// source_url -> YouTube video id (the key for videos.list) and stamp each
// snapshot with a hours-since-publish age so heterogeneous-age readings stay
// alignable on a single curve.

describe("videoIdFromUrl", () => {
  it("parses the standard watch URL", () => {
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=uR6vmM90SzE")).toBe("uR6vmM90SzE");
  });
  it("parses the short youtu.be URL", () => {
    expect(videoIdFromUrl("https://youtu.be/uR6vmM90SzE")).toBe("uR6vmM90SzE");
  });
  it("keeps the v param even with extra query params (e.g. a timestamp)", () => {
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=abc123XYZ_-&t=42s")).toBe(
      "abc123XYZ_-",
    );
  });
  it("returns null for a non-video URL and for garbage", () => {
    expect(videoIdFromUrl("https://www.youtube.com/@TuckerCarlson")).toBeNull();
    expect(videoIdFromUrl("not a url")).toBeNull();
  });
});

describe("ageHours", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  it("is whole hours since publish, floored", () => {
    expect(ageHours("2026-06-20T09:30:00Z", now)).toBe(2); // 2.5h -> 2
    expect(ageHours("2026-06-13T12:00:00Z", now)).toBe(168); // 7 days
  });
  it("never goes negative (a future/just-published timestamp clamps to 0)", () => {
    expect(ageHours("2026-06-20T13:00:00Z", now)).toBe(0);
  });
  it("returns 0 for an unparseable date instead of NaN", () => {
    expect(ageHours("nonsense", now)).toBe(0);
  });
});
