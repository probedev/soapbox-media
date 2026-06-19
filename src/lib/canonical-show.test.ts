import { describe, it, expect } from "vitest";
import {
  canonicalShowKey,
  groupByCanonicalShow,
  preferredShowReach,
} from "./canonical-show";

// Locks the canonical-show grouping used by reach-favoring and the
// "who moved this issue" chart: same-name YouTube + podcast rows collapse to one
// show, and reach prefers the measured YouTube number.

describe("canonicalShowKey", () => {
  it("normalizes punctuation/case so siblings share a key", () => {
    expect(canonicalShowKey("Democracy Now!")).toBe(canonicalShowKey("democracy now"));
    expect(canonicalShowKey("The Majority Report w/ Sam Seder")).toBe(
      canonicalShowKey("The Majority Report w/ Sam Seder"),
    );
  });
});

describe("groupByCanonicalShow", () => {
  it("collapses a dual-platform show into one group, preserving order", () => {
    const rows = [
      { name: "Breaking Points", platform: "youtube" as const, reach: 2_060_000 },
      { name: "The Bulwark", platform: "podcast" as const, reach: 500_000 },
      { name: "Breaking Points", platform: "podcast" as const, reach: 1_500_000 },
    ];
    const groups = groupByCanonicalShow(rows);
    expect(groups.map((g) => g.members.length)).toEqual([2, 1]); // BP merged, Bulwark alone
    expect(groups[0].members.map((m) => m.platform)).toEqual(["youtube", "podcast"]);
  });

  it("drops rows whose name cannot be canonicalized", () => {
    const groups = groupByCanonicalShow([{ name: "", platform: "podcast" as const, reach: 1 }]);
    expect(groups).toEqual([]);
  });
});

describe("preferredShowReach", () => {
  it("prefers the highest YouTube reach over any podcast estimate", () => {
    const members = [
      { name: "Breaking Points", platform: "youtube" as const, reach: 2_060_000 },
      { name: "Breaking Points", platform: "podcast" as const, reach: 1_500_000 },
    ];
    expect(preferredShowReach(members)).toBe(2_060_000);
  });

  it("falls back to the max reach when there is no YouTube row", () => {
    const members = [
      { name: "John Solomon Reports", platform: "podcast" as const, reach: 200_000 },
    ];
    expect(preferredShowReach(members)).toBe(200_000);
  });
});
