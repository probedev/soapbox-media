import { describe, it, expect } from "vitest";
import {
  quoteStartSeconds,
  formatTimestamp,
  timestampedSourceUrl,
  type TranscriptSegment,
} from "./transcript-timing";

// A tiny stand-in for Supadata native-caption chunks: { t: startSeconds, x: text }.
const SEGMENTS: TranscriptSegment[] = [
  { t: 0, x: ">> WELCOME BACK TO THE SHOW," },
  { t: 5, x: "we were talking about the border earlier." },
  { t: 12, x: "The only real proponents of this deal" },
  { t: 15, x: "are the administration officials themselves." },
  { t: 21, x: "Across the political spectrum people disagree." },
  { t: 27, x: "we were talking about something else now." },
];

describe("quoteStartSeconds", () => {
  it("anchors a verbatim quote to its segment start", () => {
    // Quote spans segments at t=12 and t=15; the start lives at t=12.
    expect(
      quoteStartSeconds(
        "The only real proponents of this deal are the administration officials themselves.",
        SEGMENTS,
      ),
    ).toBe(12);
  });

  it("tolerates the model's punctuation/casing drift", () => {
    // Different case + punctuation than the caption, same words.
    expect(
      quoteStartSeconds("the only real PROPONENTS of this deal!!", SEGMENTS),
    ).toBe(12);
  });

  it("tolerates drift in the tail of the quote (anchors on the prefix)", () => {
    // Tail diverges from the transcript; the prefix still locates t=12.
    expect(
      quoteStartSeconds(
        "The only real proponents of this deal, which I think is a terrible idea frankly and so does everyone I know.",
        SEGMENTS,
      ),
    ).toBe(12);
  });

  it("returns null for a quote not in the transcript", () => {
    expect(
      quoteStartSeconds("inflation is the single biggest concern for voters", SEGMENTS),
    ).toBeNull();
  });

  it("requires a unique short prefix (ambiguous opening -> null)", () => {
    // "we were talking about" appears at t=5 and t=27, and the quote diverges
    // after it, so no long prefix matches and the short prefix is ambiguous.
    expect(quoteStartSeconds("we were talking about whatever", SEGMENTS)).toBeNull();
  });

  it("matches a short but uniquely-present quote (below the prefix tiers)", () => {
    // "across the political spectrum people" is < 40 chars but unique -> t=21.
    expect(quoteStartSeconds("Across the political spectrum people", SEGMENTS)).toBe(21);
  });

  it("returns null without segments", () => {
    expect(quoteStartSeconds("anything at all here", null)).toBeNull();
    expect(quoteStartSeconds("anything at all here", [])).toBeNull();
    expect(quoteStartSeconds(null, SEGMENTS)).toBeNull();
  });

  it("returns null for too-short quotes", () => {
    expect(quoteStartSeconds("the border", SEGMENTS)).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("formats mm:ss under an hour", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(75)).toBe("1:15");
    expect(formatTimestamp(1215)).toBe("20:15");
  });
  it("formats h:mm:ss past an hour", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });
});

describe("timestampedSourceUrl", () => {
  it("appends t=<s>s to a youtube watch url", () => {
    expect(timestampedSourceUrl("https://www.youtube.com/watch?v=ME0prQf6vro", 1215)).toBe(
      "https://www.youtube.com/watch?v=ME0prQf6vro&t=1215s",
    );
  });
  it("appends to a youtu.be short url", () => {
    expect(timestampedSourceUrl("https://youtu.be/ME0prQf6vro", 42)).toBe(
      "https://youtu.be/ME0prQf6vro?t=42s",
    );
  });
  it("leaves non-youtube (podcast) urls unchanged", () => {
    const u = "https://traffic.megaphone.fm/ep123.mp3";
    expect(timestampedSourceUrl(u, 100)).toBe(u);
  });
  it("leaves the url unchanged when there is no timestamp", () => {
    const u = "https://www.youtube.com/watch?v=abc";
    expect(timestampedSourceUrl(u, null)).toBe(u);
    expect(timestampedSourceUrl(u, 0)).toBe(u);
  });
  it("replaces an existing t= rather than duplicating it", () => {
    expect(
      timestampedSourceUrl("https://www.youtube.com/watch?v=abc&t=10s", 99),
    ).toBe("https://www.youtube.com/watch?v=abc&t=99s");
  });
});
