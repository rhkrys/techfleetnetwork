import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  classifyAuthError,
  isUnrecoverableAuthError,
  isLikelyJwt,
  purgeLocalAuthState,
  ensureClientFingerprint,
} from "@/lib/auth/session-health";

describe("session-health.classifyAuthError", () => {
  it("classifies refresh-token failures", () => {
    for (const msg of [
      "Invalid Refresh Token: Already Used",
      "refresh token not found",
      "Refresh token has been revoked",
      "refresh token expired",
    ]) {
      expect(classifyAuthError(new Error(msg))).toBe("refresh_invalid");
    }
  });

  it("classifies every observed JWT-corrupt variant from prod logs", () => {
    for (const msg of [
      "bad_jwt",
      "invalid JWT: unable to parse or verify signature",
      "token contains an invalid number of segments",
      "token is malformed",
      "JWT signature is invalid",
    ]) {
      expect(classifyAuthError(new Error(msg))).toBe("jwt_corrupt");
    }
  });

  it("returns 'ok' for unrelated errors", () => {
    for (const msg of ["network error", "rate limited", "captcha required", ""]) {
      expect(classifyAuthError(new Error(msg))).toBe("ok");
    }
    expect(classifyAuthError(null)).toBe("ok");
    expect(classifyAuthError(undefined)).toBe("ok");
  });

  it("isUnrecoverableAuthError covers both unrecoverable classes", () => {
    expect(isUnrecoverableAuthError(new Error("bad_jwt"))).toBe(true);
    expect(isUnrecoverableAuthError(new Error("refresh token revoked"))).toBe(true);
    expect(isUnrecoverableAuthError(new Error("network"))).toBe(false);
  });
});

describe("session-health.isLikelyJwt", () => {
  it("accepts a structurally valid JWT", () => {
    expect(isLikelyJwt("eyJhbGciOi.eyJzdWIiOi.SflKxw")).toBe(true);
  });
  it("rejects non-JWT shapes", () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "..", "a..c", null, 123, undefined]) {
      expect(isLikelyJwt(bad as unknown)).toBe(false);
    }
  });
});

describe("session-health.purgeLocalAuthState", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("clears every sb-*-auth-token entry from both storages", () => {
    localStorage.setItem("sb-abc-auth-token", "x");
    localStorage.setItem("sb-xyz-auth-token", "y");
    sessionStorage.setItem("sb-abc-auth-token", "z");
    localStorage.setItem("unrelated", "keep");
    purgeLocalAuthState({ reason: "manual" });
    expect(localStorage.getItem("sb-abc-auth-token")).toBeNull();
    expect(localStorage.getItem("sb-xyz-auth-token")).toBeNull();
    expect(sessionStorage.getItem("sb-abc-auth-token")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});

describe("session-health.ensureClientFingerprint", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("purges when stored fingerprint does not match current env", () => {
    // ensureClientFingerprint no-ops without VITE_SUPABASE_* (gate-test runs
    // with none); stub them so a fingerprint is computed and the mismatch fires.
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-anon-key-0123456789abcdef");
    localStorage.setItem("tfn_auth_client_fingerprint_v1", "stale::fingerprint::0");
    localStorage.setItem("sb-abc-auth-token", "x");
    ensureClientFingerprint();
    expect(localStorage.getItem("sb-abc-auth-token")).toBeNull();
    // Fresh fingerprint written.
    expect(localStorage.getItem("tfn_auth_client_fingerprint_v1")).not.toBe(
      "stale::fingerprint::0"
    );
    vi.unstubAllEnvs();
  });

  it("is a no-op when fingerprint matches", () => {
    ensureClientFingerprint(); // seed
    localStorage.setItem("sb-abc-auth-token", "x");
    ensureClientFingerprint(); // second call, same env
    expect(localStorage.getItem("sb-abc-auth-token")).toBe("x");
  });
});
