/**
 * Smoke tests for the Phase-2 unified observability surface.
 *
 * Covers:
 *   - report() drops extension-frame errors
 *   - report() drops offline errors
 *   - report() drops AbortError
 *   - toError() canonicalizes Supabase {code,message,details} objects
 *   - typed AppError subclasses set `instanceof` correctly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classify } from "@/lib/observability/classify";
import { toError } from "@/lib/errors/toError";
import {
  AppError,
  NotFoundError,
  EdgeInvokeError,
  RpcError,
  SerializationError,
} from "@/lib/errors/AppError";

describe("triage-permanent-fix: classify()", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("drops extension-frame errors (chrome-extension://)", () => {
    const err = new Error("Cannot read properties of undefined");
    err.stack = "Error\n    at chrome-extension://abc/contentScript.js:1:1";
    expect(classify(err).report).toBe(false);
    expect(classify(err).reason).toBe("extension_frame");
  });

  it("drops AbortError", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classify(err).report).toBe(false);
    expect(classify(err).reason).toBe("aborted");
  });

  it("drops errors when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const err = new TypeError("fetch failed");
    expect(classify(err).report).toBe(false);
    expect(classify(err).reason).toBe("offline");
  });

  it("reports real bugs", () => {
    const err = new Error("Genuine null pointer");
    expect(classify(err).report).toBe(true);
  });
});

describe("triage-permanent-fix: toError()", () => {
  it("canonicalizes Supabase error objects", () => {
    const supa = { code: "PGRST116", message: "no rows", details: "x", hint: "y" };
    const e = toError(supa);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).not.toBe("[object Object]");
    expect(e.message).toContain("no rows");
  });

  it("preserves real Errors", () => {
    const orig = new Error("boom");
    expect(toError(orig)).toBe(orig);
  });

  it("handles strings", () => {
    expect(toError("nope").message).toBe("nope");
  });
});

describe("triage-permanent-fix: AppError hierarchy", () => {
  it("NotFoundError sets retriable=false and proper name", () => {
    const e = new NotFoundError("Coordinator");
    expect(e).toBeInstanceOf(AppError);
    expect(e.retriable).toBe(false);
    expect(e.name).toBe("NotFoundError");
    expect(e.code).toBe("not_found");
  });

  it("EdgeInvokeError carries fnName + status", () => {
    const e = new EdgeInvokeError("save-app", "fail", { status: 500, retriable: true });
    expect(e.fnName).toBe("save-app");
    expect(e.status).toBe(500);
    expect(e.retriable).toBe(true);
  });

  it("RpcError carries rpcName + pgCode", () => {
    const e = new RpcError("has_role", "permission denied", { pgCode: "42501" });
    expect(e.rpcName).toBe("has_role");
    expect(e.pgCode).toBe("42501");
  });

  it("SerializationError exists for [object Object] rescues", () => {
    const e = new SerializationError("non-Error thrown");
    expect(e.name).toBe("SerializationError");
  });
});
