import { describe, it, expect, vi } from "vitest";
import { retryTransientWrite } from "@/lib/db/retry";

/**
 * Unit tests for the shared retryTransientWrite helper.
 * Promoted from class.service.ts so cohort + future writers share one behavior.
 */
describe("retryTransientWrite", () => {
  it("returns the value on first success without sleeping", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const out = await retryTransientWrite(fn);
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient PGRST002 then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "PGRST002", message: "schema cache miss" })
      .mockResolvedValueOnce("ok");
    const out = await retryTransientWrite(fn, { baseMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 'upstream request timeout' message", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ message: "upstream request timeout" })
      .mockResolvedValueOnce("ok");
    const out = await retryTransientWrite(fn, { baseMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on RLS denial (42501)", async () => {
    const err = { code: "42501", message: "new row violates row-level security policy" };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryTransientWrite(fn, { baseMs: 1 })).rejects.toMatchObject({ code: "42501" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on validation/4xx errors", async () => {
    const err = { status: 400, message: "bad request" };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryTransientWrite(fn, { baseMs: 1 })).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured number of attempts", async () => {
    const err = { message: "upstream request timeout" };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryTransientWrite(fn, { attempts: 3, baseMs: 1 })).rejects.toMatchObject({
      message: "upstream request timeout",
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
