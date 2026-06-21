import { describe, it, expect } from "vitest";
import { rankRunaways } from "./view-stats";

// Ranks a channel's mature videos into over/under-performers by view count
// relative to the channel's typical (median). Drives the MCP runaway surface.

const v = (title: string, views: number | null) => ({
  title,
  source_url: `https://youtu.be/${title}`,
  published_at: "2026-05-20T00:00:00Z",
  view_count: views,
});

describe("rankRunaways", () => {
  const typical = 100_000;
  const vids = [
    v("flop", 10_000), // 0.1x
    v("normal", 100_000), // 1.0x
    v("hit", 500_000), // 5.0x
    v("ok", 120_000), // 1.2x
    v("dud", 30_000), // 0.3x
  ];

  it("top = highest views with performance = views / typical", () => {
    const { top } = rankRunaways(vids, typical, 2);
    expect(top.map((r) => r.title)).toEqual(["hit", "ok"]);
    expect(top[0].performance).toBe(5);
    expect(top[1].performance).toBe(1.2);
  });

  it("bottom = lowest views, most extreme underperformer first", () => {
    const { bottom } = rankRunaways(vids, typical, 2);
    expect(bottom.map((r) => r.title)).toEqual(["flop", "dud"]);
    expect(bottom[0].performance).toBe(0.1);
  });

  it("drops videos with no view count", () => {
    const { top } = rankRunaways([...vids, v("hidden", null)], typical, 5);
    expect(top.find((r) => r.title === "hidden")).toBeUndefined();
  });

  it("top and bottom don't overlap when the sample is small", () => {
    const { top, bottom } = rankRunaways(vids, typical, 5);
    const topTitles = new Set(top.map((r) => r.title));
    expect(bottom.every((r) => !topTitles.has(r.title))).toBe(true);
  });

  it("performance is 0 (not Infinity/NaN) when typical is 0", () => {
    const { top } = rankRunaways(vids, 0, 1);
    expect(top[0].performance).toBe(0);
  });
});
