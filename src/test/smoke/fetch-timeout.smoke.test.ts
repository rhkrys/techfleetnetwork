// Smoke coverage for audit T-H — outbound edge fetches must have a hard timeout
// (AbortController), so a hung remote (e.g. a stuck Discord webhook) can't block
// a cron tick indefinitely. Behavioral test of the shared helper + grep
// invariants that the previously-unguarded Discord posts now use it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchWithTimeout } from "../../../supabase/functions/_shared/fetch-timeout.ts";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithTimeout (smoke)", () => {
  it("TH-FETCH-001: aborts a hung request once the timeout elapses", async () => {
    // A fetch that never resolves on its own — only settles when its signal aborts.
    vi.stubGlobal(
      "fetch",
      (_input: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const sig = init.signal as AbortSignal;
          sig.addEventListener("abort", () => reject(sig.reason ?? new Error("aborted")));
        })
    );
    await expect(fetchWithTimeout("https://example.test/hang", {}, 20)).rejects.toBeTruthy();
  });

  it("TH-FETCH-002: passes a fast response through and does not abort", async () => {
    const ok = new Response("ok", { status: 200 });
    let aborted = false;
    vi.stubGlobal("fetch", (_input: unknown, init: RequestInit) => {
      (init.signal as AbortSignal)?.addEventListener("abort", () => {
        aborted = true;
      });
      return Promise.resolve(ok);
    });
    const res = await fetchWithTimeout("https://example.test/ok", {}, 1000);
    expect(res.status).toBe(200);
    expect(aborted).toBe(false);
  });

  it("TH-FETCH-003: the previously-unguarded Discord posts now use fetchWithTimeout", () => {
    const health = read("supabase/functions/refresh-email-health/index.ts");
    const announce = read("supabase/functions/send-announcement-email/index.ts");
    // both refresh-email-health webhook posts + the announcement post are guarded
    expect((health.match(/fetchWithTimeout\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(announce).toMatch(/fetchWithTimeout\(/);
    // no bare `fetch(` on those webhook variables remains
    expect(health).not.toMatch(/await fetch\(webhookUrl/);
    expect(announce).not.toMatch(/await fetch\(platformWebhook/);
  });
});
