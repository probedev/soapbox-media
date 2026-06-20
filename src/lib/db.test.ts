import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { noStoreFetch } from "./db";

// noStoreFetch is the single choke point every Supabase request flows through.
// The load-bearing property under test: idempotent reads (GET/HEAD) retry on a
// transient failure, but writes (POST/PATCH/DELETE) NEVER retry - retrying a
// non-idempotent insert whose response was merely lost could double-insert.

const ok = (status: number) => new Response(null, { status });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("noStoreFetch transient-retry", () => {
  it("retries an idempotent GET on a transient 503, then succeeds", async () => {
    const mock = vi.fn().mockResolvedValueOnce(ok(503)).mockResolvedValueOnce(ok(200));
    vi.stubGlobal("fetch", mock);
    const r = await noStoreFetch("https://x/y"); // method defaults to GET
    expect(r.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("retries a GET that throws a network error, then succeeds", async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(ok(200));
    vi.stubGlobal("fetch", mock);
    const r = await noStoreFetch("https://x/y", { method: "GET" });
    expect(r.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-idempotent POST (write safety)", async () => {
    const mock = vi.fn().mockResolvedValueOnce(ok(503));
    vi.stubGlobal("fetch", mock);
    const r = await noStoreFetch("https://x/y", { method: "POST" });
    expect(r.status).toBe(503); // returns the transient response, does not mask it
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a write that throws (would risk a double insert)", async () => {
    const mock = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", mock);
    await expect(noStoreFetch("https://x/y", { method: "PATCH" })).rejects.toThrow("ECONNRESET");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a successful GET", async () => {
    const mock = vi.fn().mockResolvedValueOnce(ok(200));
    vi.stubGlobal("fetch", mock);
    await noStoreFetch("https://x/y");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("gives up after max attempts on a persistent 500 and returns it", async () => {
    const mock = vi.fn().mockResolvedValue(ok(500));
    vi.stubGlobal("fetch", mock);
    const r = await noStoreFetch("https://x/y");
    expect(r.status).toBe(500);
    expect(mock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("forces cache: no-store on the underlying fetch", async () => {
    const mock = vi.fn().mockResolvedValueOnce(ok(200));
    vi.stubGlobal("fetch", mock);
    await noStoreFetch("https://x/y");
    expect(mock).toHaveBeenCalledWith("https://x/y", expect.objectContaining({ cache: "no-store" }));
  });
});
