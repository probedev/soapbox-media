import { describe, it, expect } from "vitest";
import {
  detectAdCandidates,
  canonicalAdvertiser,
  despellLetters,
  normalizeDomain,
  cleanAdExcerpt,
} from "./ads";

const FILLER = "we talked about the debate and the economy and the polls ".repeat(20);

describe("detectAdCandidates", () => {
  it("qualifies a segment on one strong anchor", () => {
    const text = `${FILLER}This episode is sponsored by Quince. Go to quince.com/show for free shipping.${FILLER}`;
    const segs = detectAdCandidates(text);
    expect(segs.length).toBe(1);
    expect(segs[0].strongHits).toBeGreaterThanOrEqual(1);
    expect(segs[0].excerpt).toContain("sponsored by Quince");
  });

  it("does not qualify on a single weak anchor", () => {
    const text = `${FILLER}the bill would give families 20% off their premiums under the plan${FILLER}`;
    expect(detectAdCandidates(text)).toHaveLength(0);
  });

  it("qualifies on two weak anchors and merges nearby hits into one segment", () => {
    const text = `${FILLER}get 20% off for a limited time, link in the description${FILLER}`;
    const segs = detectAdCandidates(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].weakHits).toBeGreaterThanOrEqual(2);
  });

  it("splits anchors far apart into separate segments", () => {
    const gap = "and then we moved on to other things entirely ".repeat(50);
    const text = `${FILLER}use code SHOW at checkout ${gap} brought to you by BetterHelp${FILLER}`;
    expect(detectAdCandidates(text).length).toBe(2);
  });

  it("picks up the inline caption timestamp before the segment", () => {
    const text = `${FILLER}[00:10:30.000 --> 00:10:45.000] and now a word. This episode is sponsored by Acme. Use code ACME today.${FILLER}`;
    const segs = detectAdCandidates(text);
    expect(segs[0].startTs).toBe(630);
  });
});

describe("cleanAdExcerpt", () => {
  it("strips timestamps, speaker tags, and sound markers", () => {
    const raw =
      "[00:40:47.160 --> 00:40:53.360] [SPEAKER_08] Our sponsor [music] makes it easy";
    expect(cleanAdExcerpt(raw)).toBe("Our sponsor makes it easy");
  });
});

describe("despellLetters / normalizeDomain", () => {
  it("collapses letter-by-letter spellings", () => {
    expect(despellLetters("q-u-i-n-c-e")).toBe("quince");
    expect(despellLetters("o d o o")).toBe("odoo");
  });
  it("leaves normal words alone", () => {
    expect(despellLetters("quince dot com")).toBe("quince dot com");
  });
  it("normalizes spoken and spelled domains", () => {
    expect(normalizeDomain("Quince dot com")).toBe("quince.com");
    expect(normalizeDomain("q-u-i-n-c-e.com")).toBe("quince.com");
    expect(normalizeDomain("https://www.quince.com/show")).toBe("quince.com");
  });
  it("nulls platform domains", () => {
    expect(normalizeDomain("youtube.com")).toBeNull();
  });
});

describe("canonicalAdvertiser", () => {
  it("folds brand, domain, and spelled-out variants onto one slug", () => {
    const a = canonicalAdvertiser("Quince", null);
    const b = canonicalAdvertiser(null, "quince.com");
    const c = canonicalAdvertiser(null, "q-u-i-n-c-e.com");
    expect(a?.slug).toBe("quince");
    expect(b?.slug).toBe("quince");
    expect(c?.slug).toBe("quince");
    expect(a?.name).toBe("Quince");
  });

  it("uses the known-brand display name over the model's casing", () => {
    expect(canonicalAdvertiser("policy genius", null)?.name).toBe("PolicyGenius");
    expect(canonicalAdvertiser("The Farmer's Dog", null)?.slug).toBe("farmersdog");
  });

  it("keeps unknown brands with the model's name and the domain", () => {
    const r = canonicalAdvertiser("Expat Money", "expatmoney.com");
    expect(r).toEqual({ slug: "expatmoney", name: "Expat Money", domain: "expatmoney.com" });
  });

  it("returns null when nothing survives normalization", () => {
    expect(canonicalAdvertiser(null, null)).toBeNull();
    expect(canonicalAdvertiser("", "youtube.com")).toBeNull();
  });
});

// parseAdVerdict lives in src/modules/ads but is pure - tested here with the
// response shapes the backfill actually saw from multi-ad excerpts.
import { parseAdVerdict } from "@/modules/ads";

describe("parseAdVerdict", () => {
  it("parses a clean fenced object", () => {
    const r = parseAdVerdict('```json\n{"kind": "ad", "advertiser": "Quince", "domain": "quince.com"}\n```');
    expect(r).toEqual({ kind: "ad", advertiser: "Quince", domain: "quince.com" });
  });

  it("takes the first element when the model returns arrays (multi-ad break)", () => {
    const r = parseAdVerdict(
      '```json\n{"kind": "ad", "advertiser": ["Just Food For Dogs", "Maximus Tribe"], "domain": ["justfoodfordogs.com", "maximustribe.com"]}\n```',
    );
    expect(r).toEqual({ kind: "ad", advertiser: "Just Food For Dogs", domain: "justfoodfordogs.com" });
  });

  it("takes the first object when the model returns several", () => {
    const r = parseAdVerdict(
      '{"kind": "ad", "advertiser": "Quince", "domain": null}\n{"kind": "ad", "advertiser": "Odoo", "domain": "odoo.com"}',
    );
    expect(r?.advertiser).toBe("Quince");
  });

  it("returns null on garbage or an unknown kind", () => {
    expect(parseAdVerdict("I could not classify this.")).toBeNull();
    expect(parseAdVerdict('{"kind": "maybe"}')).toBeNull();
  });
});
