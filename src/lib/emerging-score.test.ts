import { describe, it, expect } from "vitest";
import {
  topicWeight,
  computeVelocity,
  emergingScore,
  RECENCY_HALF_LIFE_DAYS,
  BREAKING_MIN_RECENT,
} from "./emerging-score";

const DAY = 86_400_000;

// Locks the /emerging board math: recency decay, the breaking-velocity rule, and
// the momentum-blended emerging score.

describe("topicWeight (recency decay)", () => {
  const now = Date.UTC(2026, 0, 8);

  it("is full reach weight at age 0 and halves every half-life", () => {
    const reach = 100_000; // reachFactor = 5
    expect(topicWeight(reach, new Date(now).toISOString(), now)).toBeCloseTo(5);
    expect(
      topicWeight(reach, new Date(now - RECENCY_HALF_LIFE_DAYS * DAY).toISOString(), now),
    ).toBeCloseTo(2.5);
    expect(
      topicWeight(reach, new Date(now - 2 * RECENCY_HALF_LIFE_DAYS * DAY).toISOString(), now),
    ).toBeCloseTo(1.25);
  });

  it("treats a future-dated episode as age 0 (never negative age)", () => {
    expect(topicWeight(100_000, new Date(now + 5 * DAY).toISOString(), now)).toBeCloseTo(5);
  });
});

describe("computeVelocity (breaking signal)", () => {
  it("is not breaking below the recent-mentions floor", () => {
    expect(computeVelocity(BREAKING_MIN_RECENT - 1, 0).breaking).toBe(false);
  });

  it("flags a doubled week above the floor", () => {
    const v = computeVelocity(20, 8); // 2.5x, recent >= floor
    expect(v.breaking).toBe(true);
    expect(v.ratio).toBe(2.5);
  });

  it("does NOT flag a sub-2x week even above the floor", () => {
    expect(computeVelocity(10, 8).breaking).toBe(false); // 1.25x
  });

  it("treats a brand-new surge (no prior week) as breaking, with null ratio", () => {
    expect(computeVelocity(12, 0)).toEqual({
      breaking: true,
      ratio: null,
      recent7: 12,
      prior7: 0,
    });
  });
});

describe("emergingScore (volume x smoothed momentum)", () => {
  it("boosts an accelerating issue over a flat one of equal weight", () => {
    const flat = emergingScore(100, 50, 50);
    const rising = emergingScore(100, 50, 5);
    expect(rising).toBeGreaterThan(flat);
  });

  it("Laplace-smooths a tiny topic with an empty prior week (no blow-up)", () => {
    // 3 recent vs 0 prior: raw ratio is infinite; smoothed (3+3)/(0+3) = 2
    expect(emergingScore(10, 3, 0)).toBeCloseTo(20);
  });
});
