// Regression: noise patterns historically flooded agent_fix_queue.
// Layer = reporter (SUPPRESSED_PATTERNS). DB-trigger / queue-gate layers covered by
// known-issue-catalog-coverage.test.ts + DB integration suites.
import { describe, it, expect } from "vitest";
import { isSuppressed } from "@/services/error-reporter.service";

describe("incident: reporter-layer noise drops", () => {
  it("drops ResizeObserver loop noise", () => {
    expect(isSuppressed("ResizeObserver loop completed with undelivered notifications")).toBe(true);
    expect(isSuppressed("ResizeObserver loop limit exceeded")).toBe(true);
  });

  it("drops MetaMask / extension-context-invalidated", () => {
    expect(isSuppressed("Extension context invalidated")).toBe(true);
    expect(isSuppressed("Failed to connect to MetaMask: error xyz")).toBe(true);
  });

  it("drops AbortError families (query cancellation)", () => {
    expect(isSuppressed("AbortError: The user aborted a request.")).toBe(true);
    expect(isSuppressed("The operation was aborted")).toBe(true);
  });

  it("drops CookieYes third-party banner noise", () => {
    expect(isSuppressed("Looks like your website URL has changed")).toBe(true);
    expect(isSuppressed("cdn-cookieyes.com script load error")).toBe(true);
  });

  it("drops CSP unsafe-eval noise", () => {
    expect(
      isSuppressed("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script"),
    ).toBe(true);
  });

  it("drops empty unhandledrejection payloads", () => {
    expect(isSuppressed("{}")).toBe(true);
    expect(isSuppressed("")).toBe(true);
  });

  it("does NOT suppress real validation errors — they must surface", () => {
    expect(isSuppressed("validation_rejected: body.email Invalid email")).toBe(false);
    expect(isSuppressed("Coordinator not found")).toBe(false);
  });
});
