import { describe, it, expect } from "vitest";
import {
  formatLean,
  leanColor,
  sentimentChipStyle,
  leanChipStyle,
  LEAN_NEUTRAL_BAND,
} from "./lean";

// Locks the site's signature L/R convention: the red(=Right)/blue(=Left) palette,
// the L+/R+ labels, the 0.05 aggregate-lean neutral band, and the
// flips-at-exactly-0 sentiment chip. If any of these change, that's a deliberate
// product decision and this file should change with it - not silently.

describe("formatLean (aggregate lean, 0.05 neutral band)", () => {
  it("labels right above the band, left below it", () => {
    expect(formatLean(2.3)).toBe("R+2.3");
    expect(formatLean(-1.4)).toBe("L+1.4");
  });

  it("rounds to one decimal", () => {
    expect(formatLean(1.249)).toBe("R+1.2");
    expect(formatLean(-0.06)).toBe("L+0.1");
  });

  it("treats the neutral band (inclusive of the boundary) as neutral", () => {
    expect(formatLean(0)).toBe("0.0");
    expect(formatLean(0.04)).toBe("0.0");
    expect(formatLean(LEAN_NEUTRAL_BAND)).toBe("0.0"); // boundary is exclusive of L/R
    expect(formatLean(-LEAN_NEUTRAL_BAND)).toBe("0.0");
  });

  it("just past the band tips to L/R", () => {
    expect(formatLean(0.06)).toBe("R+0.1");
    expect(formatLean(-0.06)).toBe("L+0.1");
  });

  it("honors a custom neutral label", () => {
    expect(formatLean(0, "Even")).toBe("Even");
  });
});

describe("leanColor", () => {
  it("red for right, blue for left", () => {
    expect(leanColor(1)).toBe("text-red-600");
    expect(leanColor(-1)).toBe("text-blue-600");
  });

  it("neutral default and override", () => {
    expect(leanColor(0)).toBe("text-ink-body");
    expect(leanColor(0.02, "text-ink-muted")).toBe("text-ink-muted");
  });
});

describe("sentimentChipStyle (per-mention, flips at exactly 0)", () => {
  it("is 'unscored' for null", () => {
    expect(sentimentChipStyle(null)).toEqual({
      text: "unscored",
      cls: "bg-muted text-muted-foreground",
    });
  });

  it("flips at exactly 0, NOT the 0.05 band (the key distinction from formatLean)", () => {
    expect(sentimentChipStyle(0.01).text).toBe("R+0.0");
    expect(sentimentChipStyle(-0.01).text).toBe("L+0.0");
    expect(sentimentChipStyle(0)).toEqual({ text: "0.0", cls: "bg-muted text-ink-muted" });
  });

  it("colors right red, left blue", () => {
    expect(sentimentChipStyle(3.2)).toEqual({ text: "R+3.2", cls: "bg-red-100 text-red-800" });
    expect(sentimentChipStyle(-3.2)).toEqual({ text: "L+3.2", cls: "bg-blue-100 text-blue-800" });
  });
});

describe("leanChipStyle (categorical L/R/M)", () => {
  it("maps the three lean buckets", () => {
    expect(leanChipStyle("L")).toEqual({ text: "L", cls: "bg-blue-100 text-blue-800" });
    expect(leanChipStyle("R")).toEqual({ text: "R", cls: "bg-red-100 text-red-800" });
    expect(leanChipStyle("M")).toEqual({ text: "M", cls: "bg-muted text-ink-body" });
  });

  it("falls back to Middle for anything unrecognized", () => {
    expect(leanChipStyle("")).toEqual({ text: "M", cls: "bg-muted text-ink-body" });
    expect(leanChipStyle("x")).toEqual({ text: "M", cls: "bg-muted text-ink-body" });
  });
});
