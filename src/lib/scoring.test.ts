import { describe, it, expect } from "vitest";
import {
  clamp,
  reachFactor,
  weightedLean,
  toIndexScale,
  moverHasEnoughMentions,
  moverIsInteresting,
  moverScore,
  MOVER_MIN_MENTIONS,
} from "./scoring";

// Locks the Soapbox Index math (reach weighting -> weighted lean -> -10..+10
// scale) and the Biggest-Movers eligibility/ranking rules. These ARE the
// product's headline numbers; a change here should be deliberate.

describe("reachFactor", () => {
  it("is log10 with a floor at reach 10", () => {
    expect(reachFactor(10_000_000)).toBeCloseTo(7);
    expect(reachFactor(100_000)).toBeCloseTo(5);
    expect(reachFactor(10)).toBeCloseTo(1);
    expect(reachFactor(1)).toBeCloseTo(1); // floored at 10, not -> 0 or negative
    expect(reachFactor(0)).toBeCloseTo(1);
  });
});

describe("weightedLean", () => {
  it("is 0 for no rows (no divide-by-zero)", () => {
    expect(weightedLean([])).toEqual({ lean: 0, weight: 0 });
  });

  it("weights each mention by reachFactor x intensity", () => {
    // single row: lean == its sentiment, weight == reachFactor(reach) * intensity
    const row = { sentiment: 3, intensity: 2, channel_reach: 100_000 }; // rf = 5
    expect(weightedLean([row])).toEqual({ lean: 3, weight: 10 });
  });

  it("lets a higher-reach, higher-intensity mention dominate the mean", () => {
    const big = { sentiment: 4, intensity: 5, channel_reach: 10_000_000 }; // rf 7, w 35
    const small = { sentiment: -4, intensity: 1, channel_reach: 10 }; // rf 1, w 1
    expect(weightedLean([big, small]).lean).toBeGreaterThan(3); // pulled toward +4
  });
});

describe("toIndexScale", () => {
  it("doubles weighted lean onto the published -10..+10 scale", () => {
    expect(toIndexScale(0)).toBe(0);
    expect(toIndexScale(2.5)).toBe(5);
    expect(toIndexScale(-2.5)).toBe(-5);
  });

  it("clamps to the +-10 rails", () => {
    expect(toIndexScale(6)).toBe(10);
    expect(toIndexScale(-9)).toBe(-10);
  });
});

describe("clamp", () => {
  it("bounds a value within [min, max]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("biggest-movers rules", () => {
  it("requires the mention floor on BOTH windows", () => {
    expect(moverHasEnoughMentions(MOVER_MIN_MENTIONS, MOVER_MIN_MENTIONS)).toBe(true);
    expect(moverHasEnoughMentions(MOVER_MIN_MENTIONS - 1, 100)).toBe(false);
    expect(moverHasEnoughMentions(100, MOVER_MIN_MENTIONS - 1)).toBe(false);
  });

  it("earns a row on a lean swing OR a volume swing (the OR-rule)", () => {
    expect(moverIsInteresting(0.5, 1)).toBe(true); // lean floor met
    expect(moverIsInteresting(0, 1.5)).toBe(true); // volume up
    expect(moverIsInteresting(0, 0.6)).toBe(true); // volume down (<= ~0.667)
    expect(moverIsInteresting(0.1, 1.2)).toBe(false); // neither
  });

  it("ranks lean and volume swings on a comparable scale (2pt == 2x == 1.0)", () => {
    expect(moverScore(2, 1)).toBeCloseTo(1);
    expect(moverScore(0, 2)).toBeCloseTo(1);
    expect(moverScore(0, 0.5)).toBeCloseTo(1); // halving is symmetric to doubling
    expect(moverScore(4, 1)).toBeCloseTo(2); // a bigger swing ranks higher
  });
});
