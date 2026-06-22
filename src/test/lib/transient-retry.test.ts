/**
 * Locks the regression for issue #1 (PGRST002 schema-cache reload storms)
 * and issue #2 (GoTrue Web Locks AbortError) at the universal retry helper.
 *
 * BDD: INFRA-PGRST002-RETRY-001/002, AUTH-LOCK-RETRY-001/002
 */
import { describe, it, expect, vi } from "vitest";
import { withTransientRetry, retryPostgrest } from "@/lib/data/transient-retry";

describe("withTransientRetry — universal transient classifier", () => {
  it("retries on PGRST002 then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "PGRST002", message: "Could not query the database for the schema cache" })
      .mockResolvedValueOnce("ok");
    const out = await withTransientRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 503", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "Service Unavailable" })
      .mockResolvedValueOnce("ok");
    const out = await withTransientRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on TypeError: Failed to fetch", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("ok");
    const out = await withTransientRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 408 (Request Timeout)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 408, message: "Request Timeout" })
      .mockResolvedValueOnce("ok");
    const out = await withTransientRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 429 (rate limit)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: "Too Many Requests" })
      .mockResolvedValueOnce("ok");
    const out = await withTransientRetry(fn, { baseDelayMs: 1 });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 401 (auth)", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401, message: "Unauthorized" });
    await expect(withTransientRetry(fn, { baseDelayMs: 1 })).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 403 (forbidden)", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 403, message: "Forbidden" });
    await expect(withTransientRetry(fn, { baseDelayMs: 1 })).rejects.toMatchObject({ status: 403 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 404", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 404, message: "Not Found" });
    await expect(withTransientRetry(fn, { baseDelayMs: 1 })).rejects.toMatchObject({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 422 (validation / TOTP wrong code)", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 422, message: "Invalid TOTP code entered" });
    await expect(withTransientRetry(fn, { baseDelayMs: 1 })).rejects.toMatchObject({ status: 422 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on RLS denial 42501", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "42501", message: "permission denied" });
    await expect(withTransientRetry(fn, { baseDelayMs: 1 })).rejects.toMatchObject({ code: "42501" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects retries=0 (single attempt only)", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(withTransientRetry(fn, { baseDelayMs: 1, retries: 0 })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after `retries` retries on persistent transient errors", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(withTransientRetry(fn, { baseDelayMs: 1, retries: 2 })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("invokes onRetry hook with the error and attempt index", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ok");
    await withTransientRetry(fn, { baseDelayMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }), 0);
  });
});

describe("retryPostgrest — PostgREST tuple shim", () => {
  it("retries when the tuple error is transient and surfaces final success", async () => {
    const fn = vi
      .fn<() => Promise<{ data: number | null; error: { code?: string; status?: number } | null }>>()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST002" } })
      .mockResolvedValueOnce({ data: 42, error: null });
    const out = await retryPostgrest(fn, { baseDelayMs: 1 });
    expect(out).toEqual({ data: 42, error: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns the tuple as-is when the error is structural (RLS)", async () => {
    const fn = vi
      .fn<() => Promise<{ data: null; error: { code: string; message: string } }>>()
      .mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    const out = await retryPostgrest(fn, { baseDelayMs: 1 });
    expect(out.data).toBeNull();
    expect((out.error as { code?: string })?.code).toBe("42501");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
