import { describe, it, expect } from "vitest";
import {
  meetsReachFloor,
  isLeanAssignable,
  isActiveFeed,
  vetCandidate,
  SUB_FLOOR,
  STALE_DAYS,
} from "./channel-vet";

// Locks the candidate-vetting gate: who clears the bar for human review. The
// load-bearing rule is YouTube-only floor enforcement (podcast reach is
// editorial and must never be floor-gated).

const NOW = new Date("2026-06-17T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("meetsReachFloor", () => {
  it("enforces the floor for YouTube only", () => {
    expect(meetsReachFloor("youtube", SUB_FLOOR)).toBe(true); // exactly at floor
    expect(meetsReachFloor("youtube", SUB_FLOOR - 1)).toBe(false);
    expect(meetsReachFloor("youtube", 0)).toBe(false);
  });

  it("always passes podcasts regardless of editorial reach", () => {
    expect(meetsReachFloor("podcast", 50_000)).toBe(true);
    expect(meetsReachFloor("podcast", 0)).toBe(true);
    expect(meetsReachFloor("podcast", null)).toBe(true);
  });
});

describe("isLeanAssignable", () => {
  it("accepts only L/M/R", () => {
    expect(isLeanAssignable("L")).toBe(true);
    expect(isLeanAssignable("M")).toBe(true);
    expect(isLeanAssignable("R")).toBe(true);
    expect(isLeanAssignable(null)).toBe(false);
    expect(isLeanAssignable("center")).toBe(false);
  });
});

describe("isActiveFeed", () => {
  it("is active within the stale window, stale outside it", () => {
    expect(isActiveFeed(daysAgo(STALE_DAYS - 1), NOW)).toBe(true);
    expect(isActiveFeed(daysAgo(STALE_DAYS), NOW)).toBe(true); // exactly at boundary
    expect(isActiveFeed(daysAgo(STALE_DAYS + 1), NOW)).toBe(false);
  });

  it("treats null/invalid recency as not active", () => {
    expect(isActiveFeed(null, NOW)).toBe(false);
    expect(isActiveFeed("not-a-date", NOW)).toBe(false);
  });
});

describe("vetCandidate", () => {
  it("fails a sub-floor YouTube candidate", () => {
    const r = vetCandidate({ name: "X", platform: "youtube", reach: 100_000, latest_episode_at: daysAgo(1) }, NOW);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("below_floor");
  });

  it("passes a sub-floor podcast (editorial reach, not gated)", () => {
    const r = vetCandidate({ name: "X", platform: "podcast", reach: 50_000, latest_episode_at: daysAgo(1), political_lean: "R" }, NOW);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("vetted");
  });

  it("fails a known-stale feed", () => {
    const r = vetCandidate({ name: "X", platform: "youtube", reach: 500_000, latest_episode_at: daysAgo(40) }, NOW);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("stale");
  });

  it("vets but flags when recency is unknown and lean unassigned", () => {
    const r = vetCandidate({ name: "X", platform: "youtube", reach: 500_000 }, NOW);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("vetted");
    expect(r.reasons.join(" ")).toMatch(/recency unknown/);
    expect(r.reasons.join(" ")).toMatch(/lean unassigned/);
  });
});
