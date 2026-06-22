import { describe, it, expect } from "vitest";
import {
  classifyError,
  extractErrorMessage,
  isTransientError,
} from "@/lib/errors/extract";

describe("extractErrorMessage", () => {
  it("surfaces Error.message verbatim for unknown errors", () => {
    const r = extractErrorMessage(new Error("Boom"));
    expect(r.kind).toBe("unknown");
    expect(r.message).toBe("Boom");
  });

  it("handles PostgrestError-shaped objects (not Error instances)", () => {
    const pg = { message: "duplicate key value", code: "23505", details: "...", hint: null };
    const r = extractErrorMessage(pg);
    expect(r.code).toBe("23505");
    expect(r.kind).toBe("validation");
    expect(r.message).toBe("duplicate key value");
    expect(r.description).toMatch(/23505/);
  });

  it("classifies PGRST002 as transient with friendly copy", () => {
    const r = extractErrorMessage({ message: "Could not query the database for the schema cache.", code: "PGRST002" });
    expect(r.kind).toBe("transient");
    expect(r.message).toMatch(/couldn't reach the database/i);
    expect(r.description).toMatch(/PGRST002/);
  });

  it("classifies upstream request timeout message as transient", () => {
    const r = extractErrorMessage({ message: "upstream request timeout" });
    expect(r.kind).toBe("transient");
    expect(isTransientError({ message: "upstream request timeout" })).toBe(true);
  });

  it("classifies 42501 / RLS as rls with role-aware copy", () => {
    const r = extractErrorMessage({ message: "new row violates row-level security policy", code: "42501" });
    expect(r.kind).toBe("rls");
    expect(r.message).toMatch(/permission/i);
  });

  it("walks nested {error:{message}} envelopes", () => {
    const r = extractErrorMessage({ error: { message: "nope", code: "PGRST116" } });
    expect(r.code).toBe("PGRST116");
    expect(r.kind).toBe("not_found");
  });

  it("falls back gracefully on unknown shapes", () => {
    const r = extractErrorMessage(undefined, "fallback");
    expect(r.message).toBe("fallback");
    expect(r.kind).toBe("unknown");
  });

  it("never returns the opaque 'Failed to save class' fallback when err has a message", () => {
    const r = extractErrorMessage({ message: "anything truthy" });
    expect(r.message).not.toBe("Failed to save class");
  });

  it("classifyError: does not retry RLS", () => {
    expect(classifyError({ code: "42501" })).toBe("rls");
    expect(isTransientError({ code: "42501" })).toBe(false);
  });
});
