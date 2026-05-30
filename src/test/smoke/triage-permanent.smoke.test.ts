/**
 * Smoke tests for the May-2026 permanent triage refactor.
 * Each test corresponds to one TRP-### scenario in bdd_scenarios.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { classify } from "@/lib/observability/classify";
import { toError } from "@/lib/errors/toError";
import { AppError, NetworkError, NotFoundError, SerializationError } from "@/lib/errors/AppError";

describe("TRP-002 extension frame errors are not reportable", () => {
  it("drops Chrome extension frame", () => {
    const err = new Error("Failed to connect to MetaMask");
    err.stack = "Error: Failed\n    at chrome-extension://abc/inpage.js:1:1";
    expect(classify(err).report).toBe(false);
    expect(classify(err).reason).toBe("extension_frame");
  });
  it("drops Firefox extension frame", () => {
    const err = new Error("x");
    err.stack = "Error\n    at moz-extension://xyz/content.js:1:1";
    expect(classify(err).report).toBe(false);
  });
});

describe("TRP-003 offline errors are not reportable", () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  beforeEach(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
  afterEach(() => { if (originalOnLine) Object.defineProperty(Navigator.prototype, "onLine", originalOnLine); });
  it("drops fetch failures while offline", () => {
    expect(classify(new TypeError("Failed to fetch")).report).toBe(false);
    expect(classify(new TypeError("Failed to fetch")).reason).toBe("offline");
  });
});

describe("TRP-007 toError canonicalizes Supabase error shapes", () => {
  it("turns {code,message} into AppError with the message", () => {
    const e = toError({ code: "PGRST301", message: "row failed", details: "x", hint: null });
    expect(e).toBeInstanceOf(AppError);
    expect(e.message).toBe("row failed");
    expect(e.message).not.toBe("[object Object]");
  });
  it("maps PGRST116 to NotFoundError", () => {
    expect(toError({ code: "PGRST116", message: "no rows" })).toBeInstanceOf(NotFoundError);
  });
  it("wraps TypeError fetch into NetworkError", () => {
    expect(toError(new TypeError("Failed to fetch"))).toBeInstanceOf(NetworkError);
  });
  it("never emits [object Object]", () => {
    const e = toError({ weird: true });
    expect(e).toBeInstanceOf(SerializationError);
    expect(e.message).not.toBe("[object Object]");
    expect(e.message).toContain("weird");
  });
  it("preserves AppError instances", () => {
    const original = new NotFoundError("Profile");
    expect(toError(original)).toBe(original);
  });
});

describe("TRP-014 typed error hierarchy", () => {
  it("NotFoundError formats as resource + not found", () => {
    expect(new NotFoundError("Coordinator").message).toBe("Coordinator not found");
  });
  it("AppError preserves cause for debugging", () => {
    const cause = new Error("inner");
    const e = new AppError("outer", { cause });
    expect((e as { cause?: unknown }).cause).toBe(cause);
  });
});
