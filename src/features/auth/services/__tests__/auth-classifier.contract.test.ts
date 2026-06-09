import { describe, expect, it } from "vitest";
import { classifyAuthErrorCode } from "../auth-classifier";
import { ClientSessionWriteError } from "@/lib/auth/session-health";

/**
 * Classifier contract — code-first, never message-derived.
 *
 * The classic Vichea regression was: a client-side `ClientSessionWriteError`
 * whose message contained "Invalid login response" was passed to a message-
 * matching classifier and mapped to INVALID_CREDENTIALS, which fired the
 * credential counter and locked the user out.
 *
 * These tests lock the new classifier so that branch cannot exist again.
 */

describe("auth-classifier (Vichea string-match invariant)", () => {
  it("never produces invalid_credentials from a free-form message string", () => {
    for (const message of [
      "Invalid login response",
      "Invalid login credentials",
      "invalid grant",
      "invalid credentials",
      "auth failure",
      "401 Unauthorized",
    ]) {
      expect(classifyAuthErrorCode(new Error(message))).not.toBe("invalid_credentials");
    }
  });

  it("maps ClientSessionWriteError to client_session_write_failed", () => {
    const err = new ClientSessionWriteError("refresh_token_invalid");
    expect(classifyAuthErrorCode(err)).toBe("client_session_write_failed");
  });

  it("prefers the server-issued typed code over any string fallback", () => {
    expect(classifyAuthErrorCode({ code: "invalid_credentials", message: "anything" })).toBe(
      "invalid_credentials",
    );
    expect(classifyAuthErrorCode({ code: "mfa_required" })).toBe("mfa_required");
    expect(classifyAuthErrorCode({ body: { code: "rate_limited" } })).toBe("rate_limited");
  });

  it("maps HTTP transport codes to typed values", () => {
    expect(classifyAuthErrorCode({ status: 429 })).toBe("rate_limited");
    expect(classifyAuthErrorCode({ status: 401 })).toBe("invalid_credentials");
    expect(classifyAuthErrorCode({ status: 503 })).toBe("service_unavailable");
  });

  it("maps network messages to network_error (non-punitive)", () => {
    expect(classifyAuthErrorCode(new Error("Failed to fetch"))).toBe("network_error");
    expect(classifyAuthErrorCode(new Error("network is offline"))).toBe("network_error");
  });

  it("falls back to unexpected for unknown shapes", () => {
    expect(classifyAuthErrorCode(undefined)).toBe("unexpected");
    expect(classifyAuthErrorCode({})).toBe("unexpected");
    expect(classifyAuthErrorCode("random string with no signal")).toBe("unexpected");
  });
});
