import { describe, it, expect } from "vitest";
import {
  normalizeName,
  anchor,
  nameMatches,
  matchChannel,
  type ChannelLike,
} from "./channel-dedup";

// Locks channel-level dedup: this gate decides whether a discovered candidate
// is already in the panel (skip it) and whether two live rows are duplicates
// (prune one). False positives drop real channels; false negatives let dupes in.

describe("normalizeName", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeName("The Ben Shapiro Show!")).toBe("thebenshapiroshow");
    expect(normalizeName("Pod Save America")).toBe("podsaveamerica");
    expect(normalizeName("")).toBe("");
  });
});

describe("anchor", () => {
  it("picks the longest distinctive (non-stopword) token", () => {
    expect(anchor("The Ben Shapiro Show")).toBe("shapiro");
    expect(anchor("Pod Save the People")).toBe("people");
    expect(anchor("Pod Save the World")).toBe("world");
  });

  it("is empty when a name is all stopwords", () => {
    expect(anchor("The Daily")).toBe(""); // "daily" is a stopword here
  });
});

describe("nameMatches", () => {
  it("matches exact normalized equality", () => {
    expect(nameMatches("Pod Save America", "pod save america")).toBe(true);
  });

  it("matches a near-name variant via full-substring containment", () => {
    expect(nameMatches("Ben Shapiro", "The Ben Shapiro Show")).toBe(true);
    expect(nameMatches("The Dan Bongino Show", "Dan Bongino")).toBe(true);
    expect(nameMatches("Candace", "Candace Owens")).toBe(true); // distinctive 7-char single token
  });

  it("does NOT collide names that merely share a generic first name or word", () => {
    expect(nameMatches("David Frum Show", "David Pakman Show")).toBe(false);
    expect(nameMatches("The Glenn Beck Program", "Glenn Greenwald")).toBe(false);
    expect(nameMatches("The Lincoln Project", "The Chris Cuomo Project")).toBe(false);
    expect(nameMatches("Pod Save America", "Real America's Voice")).toBe(false);
  });

  it("does NOT collide same-prefix different-suffix names", () => {
    expect(nameMatches("Pod Save the People", "Pod Save the World")).toBe(false);
  });

  it("is false for empty names", () => {
    expect(nameMatches("", "anything")).toBe(false);
  });
});

describe("matchChannel", () => {
  const existing: (ChannelLike & { id: string })[] = [
    { id: "yt1", name: "The Ben Shapiro Show", platform: "youtube", platform_id: "UCben" },
    { id: "pc1", name: "Pod Save America", platform: "podcast", platform_id: "psa-1" },
  ];

  it("matches by exact provider id on the same platform", () => {
    const r = matchChannel({ name: "whatever", platform: "youtube", platform_id: "UCben" }, existing);
    expect(r.match?.id).toBe("yt1");
    expect(r.reason).toBe("platform_id");
    expect(r.samePlatform).toBe(true);
  });

  it("matches a same-platform near-name as a real duplicate", () => {
    const r = matchChannel({ name: "Ben Shapiro", platform: "youtube" }, existing);
    expect(r.match?.id).toBe("yt1");
    expect(r.reason).toBe("name");
    expect(r.samePlatform).toBe(true);
  });

  it("flags a cross-platform same-name match as a sibling, not a duplicate", () => {
    const r = matchChannel({ name: "Pod Save America", platform: "youtube" }, existing);
    expect(r.match?.id).toBe("pc1");
    expect(r.samePlatform).toBe(false); // sibling: same show, other platform
  });

  it("returns no match for a genuinely new channel", () => {
    const r = matchChannel({ name: "Some Brand New Show", platform: "podcast" }, existing);
    expect(r.match).toBeNull();
    expect(r.reason).toBeNull();
  });
});
