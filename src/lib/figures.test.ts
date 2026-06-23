import { describe, it, expect } from "vitest";
import {
  buildAliasRegex,
  startTsBefore,
  cleanQuote,
  isAdRead,
  extractWindows,
  type FigureMatcher,
} from "./figures";

describe("buildAliasRegex", () => {
  it("matches whole words, case-insensitively", () => {
    const re = buildAliasRegex(["elon", "musk"]);
    expect("I like Elon".match(re)).toBeTruthy();
    expect("MUSK said".match(re)).toBeTruthy();
  });

  it("does NOT match aliases buried inside other words", () => {
    // the belong/felon bug: substring 'elon' lives inside these
    const re = buildAliasRegex(["elon"]);
    expect("it belongs to the felon".match(re)).toBeNull();
  });

  it("prefers the longest alias", () => {
    const re = buildAliasRegex(["elon", "elon musk"]);
    const m = "talking about Elon Musk today".match(re);
    expect(m?.[0].toLowerCase()).toBe("elon musk");
  });

  it("escapes regex metacharacters in aliases", () => {
    const re = buildAliasRegex(["a.b"]);
    expect("axb".match(re)).toBeNull();
    expect("a.b".match(re)).toBeTruthy();
  });
});

describe("startTsBefore", () => {
  const t = "[00:01:00.000 --> 00:01:05.000] hello Elon [01:02:03.500 --> 01:02:09.000] world";
  it("returns seconds of the last marker before the offset", () => {
    expect(startTsBefore(t, t.indexOf("Elon"))).toBe(60);
    expect(startTsBefore(t, t.indexOf("world"))).toBe(3723);
  });
  it("returns null when no marker precedes", () => {
    expect(startTsBefore("no markers here", 5)).toBeNull();
  });
});

describe("cleanQuote", () => {
  it("strips timestamp markers and collapses whitespace", () => {
    expect(cleanQuote("a  [00:01:00.000 --> 00:01:05.000]   b")).toBe("a b");
  });
});

describe("isAdRead", () => {
  it("flags sponsor reads", () => {
    expect(isAdRead("now is the time to invest in Advantage Gold")).toBe(true);
    expect(isAdRead("use promo code SOAP for 20% off")).toBe(true);
    expect(isAdRead("go to ground.com for details")).toBe(true);
  });
  it("does not flag ordinary commentary", () => {
    expect(isAdRead("Elon Musk destroyed that agency")).toBe(false);
  });
});

describe("extractWindows", () => {
  const matchers: FigureMatcher[] = [
    { slug: "musk", regex: buildAliasRegex(["elon", "musk"]) },
  ];

  it("extracts a window around a mention with a timestamp", () => {
    const text = "[00:00:30.000 --> 00:00:35.000] " + "x".repeat(50) + " Elon is great " + "y".repeat(50);
    const w = extractWindows(text, matchers);
    expect(w).toHaveLength(1);
    expect(w[0].figureSlug).toBe("musk");
    expect(w[0].startTs).toBe(30);
    expect(w[0].quote).toContain("Elon is great");
  });

  it("merges nearby mentions and caps per figure", () => {
    // 3 matches within mergeWithin, in a window long enough to clear the floor
    const near = "On todays show we talk about Elon and then Musk and then elon once more, big news everyone.";
    expect(extractWindows(near, matchers).length).toBe(1);
    // 10 well-separated mentions (>mergeWithin apart), capped to 4
    const spread = Array.from({ length: 10 }, (_, i) =>
      `Segment ${i}: a fairly long sentence mentioning Elon plus surrounding context.`.padEnd(320, "."),
    ).join("");
    expect(extractWindows(spread, matchers, { maxPerFigure: 4 }).length).toBe(4);
  });

  it("drops ad-read windows", () => {
    const text = "blah ".repeat(20) + "Elon Musk, now use promo code SAVE today " + "blah ".repeat(20);
    expect(extractWindows(text, matchers)).toHaveLength(0);
  });
});
