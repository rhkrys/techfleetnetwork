/**
 * RUM-BEACON-BLOCKED-001: when an ad-blocker (uBlock, Brave Shields, etc.)
 * rejects `navigator.sendBeacon` — either by returning false OR by throwing
 * — the web-vitals reporter MUST silently fall back to a keepalive no-cors
 * `fetch` and emit ZERO console errors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __test } from "@/lib/web-vitals";

describe("web-vitals beacon — ad-blocker fallback (RUM-BEACON-BLOCKED-001)", () => {
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    consoleErrSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("falls back to fetch when sendBeacon returns false", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => false),
    });
    __test.seed({ name: "LCP", value: 1234, rating: "good" });
    __test.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/functions/v1/record-web-vital");
    expect(init).toMatchObject({ method: "POST", keepalive: true, mode: "no-cors", credentials: "omit" });
    expect(consoleErrSpy).not.toHaveBeenCalled();
  });

  it("falls back to fetch when sendBeacon throws (ad-blocker)", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => { throw new Error("ERR_BLOCKED_BY_CLIENT"); }),
    });
    __test.seed({ name: "INP", value: 42, rating: "good" });
    __test.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleErrSpy).not.toHaveBeenCalled();
  });

  it("swallows a fetch fallback rejection — RUM must never surface", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => false),
    });
    fetchMock.mockRejectedValue(new Error("ERR_BLOCKED_BY_CLIENT"));
    __test.seed({ name: "CLS", value: 0.01, rating: "good" });
    expect(() => __test.flush()).not.toThrow();
    // Allow the rejected promise to settle.
    await Promise.resolve();
    expect(consoleErrSpy).not.toHaveBeenCalled();
  });
});
