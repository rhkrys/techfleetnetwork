/**
 * Regression lock-in for resolved incident: "MetaMask / extension-context-invalidated noise"
 * + ResizeObserver loop + script-error noise + AbortError.
 *
 * The structural classifier in src/lib/observability/classify.ts is the FIRST
 * line of defense (substring patterns in known_issue_catalog are second).
 * If anyone deletes or weakens classify(), this test fails immediately.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { classify } from "@/lib/observability/classify";

describe("incident: extension-noise-classifier", () => {
  it("drops errors with a chrome-extension:// stack frame", () => {
    const err = new Error("Failed to connect to MetaMask");
    err.stack =
      "Error: Failed to connect to MetaMask\n  at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:1:1)";
    const c = classify(err);
    expect(c.report).toBe(false);
    expect(c.reason).toBe("extension_frame");
  });

  it("drops AbortError (e.g. query cancellation on unmount)", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(classify(err).report).toBe(false);
  });

  it("drops when navigator is offline", () => {
    const original = (navigator as { onLine: boolean }).onLine;
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    try {
      expect(classify(new Error("fetch failed")).report).toBe(false);
    } finally {
      Object.defineProperty(navigator, "onLine", { value: original, configurable: true });
    }
  });

  it("reports normal application errors", () => {
    const err = new Error("Failed to count progress");
    err.stack = "Error: Failed to count progress\n  at https://techfleet.network/assets/index.js:1:1";
    const c = classify(err);
    expect(c.report).toBe(true);
  });

  it("never throws on non-Error inputs (incident: use-autosave [object Object])", () => {
    // Historically use-autosave rejected with a plain object → became
    // "Error: [object Object]". Classifier must not blow up on that path.
    expect(() => classify({ foo: "bar" })).not.toThrow();
    expect(() => classify(null)).not.toThrow();
    expect(() => classify(undefined)).not.toThrow();
    expect(() => classify("string error")).not.toThrow();
    expect(classify(null).report).toBe(true);
  });
});
