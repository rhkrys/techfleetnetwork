/**
 * AUTH-VICHEA-001 regression suite.
 *
 * Vichea (June 2026) reported needing to reset their password after every
 * sign-out. Root cause: `singleFlightSetSession` validated BOTH access_token
 * AND refresh_token as JWTs, but Supabase refresh tokens are opaque strings.
 * Every successful login threw `Error("Invalid login response")`, which the
 * classifier matched as `INVALID_CREDENTIALS` via the bare "invalid login"
 * pattern, which incremented four failure counters (CAPTCHA refresh, server
 * `record_failed_login`, device lockout, server rate-limit), which after a
 * few attempts triggered the suspicious-session revoker — forcing a reset.
 *
 * These tests lock down the structural fix. Deleting any of them allows the
 * bug to ship again.
 */
import { describe, it, expect } from "vitest";
import {
  isLikelyJwt,
  isOpaqueRefreshToken,
  ClientSessionWriteError,
  isClientSessionWriteError,
} from "@/lib/auth/session-health";
import { classifyAuthError } from "@/lib/auth-error-classifier";

const VALID_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJpYXQiOjE1MTYyMzkwMjJ9" +
  ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

// Realistic shape of a Supabase refresh token: opaque, base64-ish, ~50-100 chars.
const OPAQUE_REFRESH = "v1.MR0qY8nC2lP3wKfHj9Tx0Bv4u5SgZaD8eF1iJ6oL2cM7aB3dE0pQ";

describe("AUTH-VICHEA-001: refresh token shape", () => {
  it("accepts an opaque refresh token returned by GoTrue", () => {
    expect(isOpaqueRefreshToken(OPAQUE_REFRESH)).toBe(true);
  });

  it("does NOT require refresh tokens to be JWTs", () => {
    // The Vichea bug was caused by feeding the refresh token to isLikelyJwt.
    // Verify that an opaque refresh token would fail that check — confirming
    // why the old code rejected every valid login.
    expect(isLikelyJwt(OPAQUE_REFRESH)).toBe(false);
    expect(isOpaqueRefreshToken(OPAQUE_REFRESH)).toBe(true);
  });

  it("still validates the access token AS a JWT (correct behavior)", () => {
    expect(isLikelyJwt(VALID_JWT)).toBe(true);
  });

  it("rejects empty / too-short / non-string refresh tokens", () => {
    expect(isOpaqueRefreshToken("")).toBe(false);
    expect(isOpaqueRefreshToken("short")).toBe(false);
    expect(isOpaqueRefreshToken(null)).toBe(false);
    expect(isOpaqueRefreshToken(undefined)).toBe(false);
    expect(isOpaqueRefreshToken(123)).toBe(false);
  });
});

describe("AUTH-VICHEA-001: classifier is code-first", () => {
  it("recognises ClientSessionWriteError by class, not message", () => {
    const err = new ClientSessionWriteError("refresh_token_invalid");
    const out = classifyAuthError(err);
    expect(out.kind).toBe("CLIENT_SESSION_WRITE_FAILED");
    expect(out.countsAgainstUser).toBe(false);
  });

  it("treats a plain Error with the OLD 'Invalid login response' string as NOT credential failure", () => {
    // This is the exact string the buggy auth.service.ts used to throw. If a
    // regression ever reintroduces the string-based throw, the classifier
    // must still refuse to count it as INVALID_CREDENTIALS.
    const err = new Error("Invalid login response");
    const out = classifyAuthError(err);
    expect(out.kind).not.toBe("INVALID_CREDENTIALS");
    expect(out.countsAgainstUser).toBe(false);
  });

  it("treats network errors as non-credential", () => {
    const err = new Error("Failed to fetch");
    expect(classifyAuthError(err).countsAgainstUser).toBe(false);
  });

  it("treats CAPTCHA failures as non-credential", () => {
    const err = new Error("Verification didn't complete");
    expect(classifyAuthError(err).countsAgainstUser).toBe(false);
  });

  it("treats server 5xx as non-credential", () => {
    const err = Object.assign(new Error("upstream"), { status: 503 });
    expect(classifyAuthError(err).countsAgainstUser).toBe(false);
  });

  it("ONLY treats explicit credential phrases as INVALID_CREDENTIALS", () => {
    expect(classifyAuthError(new Error("Invalid email or password. Please try again.")).kind).toBe("INVALID_CREDENTIALS");
    expect(classifyAuthError(new Error("Invalid login credentials")).kind).toBe("INVALID_CREDENTIALS");
    expect(classifyAuthError(new Error("invalid credentials")).kind).toBe("INVALID_CREDENTIALS");
  });

  it("trusts server-issued `code: invalid_credentials` over message text", () => {
    const err = Object.assign(new Error("something else entirely"), { code: "invalid_credentials" });
    const out = classifyAuthError(err);
    expect(out.kind).toBe("INVALID_CREDENTIALS");
    expect(out.countsAgainstUser).toBe(true);
  });
});

describe("AUTH-VICHEA-001: typed error guard", () => {
  it("isClientSessionWriteError matches the class", () => {
    expect(isClientSessionWriteError(new ClientSessionWriteError("access_token_invalid"))).toBe(true);
  });

  it("isClientSessionWriteError matches duck-typed shape (cross-module instanceof safety)", () => {
    const dup = { code: "CLIENT_SESSION_WRITE_FAILED", message: "x" };
    expect(isClientSessionWriteError(dup)).toBe(true);
  });

  it("isClientSessionWriteError rejects ordinary errors", () => {
    expect(isClientSessionWriteError(new Error("anything"))).toBe(false);
    expect(isClientSessionWriteError(null)).toBe(false);
    expect(isClientSessionWriteError("string")).toBe(false);
  });
});
