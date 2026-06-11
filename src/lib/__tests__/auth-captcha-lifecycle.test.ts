/**
 * AUTH-CAPTCHA-LIFECYCLE-002 regression suite.
 *
 * "Vichea v2" (June 11, 2026): after a `client_session_write_failed`, the
 * login screen showed "Sign-in didn't complete cleanly" and the next click
 * displayed "complete human verification below" against a Turnstile widget
 * the user could not actually interact with.
 *
 * Structural fixes locked down by this file:
 *   1. Classifier copy for CLIENT_SESSION_WRITE_FAILED + SESSION_INCOMPLETE
 *      uses the new "We need to retry sign-in" / "Your account is safe"
 *      member-safe text. No more "didn't complete cleanly".
 *   2. The string `"sign-in didn't complete"` was removed from
 *      NETWORK_PATTERNS — that pattern would have re-routed the typed
 *      ClientSessionWriteError through the network branch and stripped the
 *      recovery copy if the typed guard ever missed.
 *   3. `countsAgainstUser` stays false for every non-credential failure
 *      shape — guarantees the caller can split a punitive `failureCount++`
 *      (30s Turnstile lockout) from a non-punitive `softResetCount++`
 *      (fresh token, no lockout) without re-introducing the original bug.
 */
import { describe, it, expect } from "vitest";
import { ClientSessionWriteError } from "@/lib/auth/session-health";
import { classifyAuthError } from "@/lib/auth-error-classifier";

describe("AUTH-CAPTCHA-LIFECYCLE-002: copy", () => {
  it("uses recovery-focused non-alarming copy for ClientSessionWriteError", () => {
    const out = classifyAuthError(new ClientSessionWriteError("set_session_rejected"));
    expect(out.message).toMatch(/sign in once more|try (again|once more)/i);
    expect(out.message).not.toMatch(/didn't complete cleanly/i);
    expect(out.message).not.toMatch(/couldn't finish signing in/i);
    expect(out.countsAgainstUser).toBe(false);
  });

  it("uses the same member-safe copy for the SESSION_INCOMPLETE message-text branch", () => {
    const out = classifyAuthError(new Error("Sign-in didn't complete — please try again."));
    expect(out.kind).toBe("SESSION_INCOMPLETE");
    expect(out.message).toMatch(/sign in once more|try (again|once more)/i);
    expect(out.countsAgainstUser).toBe(false);
  });
});

describe("AUTH-CAPTCHA-LIFECYCLE-002: classification stays non-punitive", () => {
  it("ClientSessionWriteError never counts against the user", () => {
    const out = classifyAuthError(new ClientSessionWriteError("access_token_invalid"));
    expect(out.countsAgainstUser).toBe(false);
  });

  it("a 503 server error never counts against the user", () => {
    const err = Object.assign(new Error("upstream"), { status: 503 });
    expect(classifyAuthError(err).countsAgainstUser).toBe(false);
  });

  it("CAPTCHA failures never count against the user", () => {
    expect(classifyAuthError(new Error("Verification didn't complete")).countsAgainstUser).toBe(false);
    expect(classifyAuthError(new Error("Turnstile token invalid")).countsAgainstUser).toBe(false);
  });

  it("auth throttle (429) never counts against the user", () => {
    const err = Object.assign(new Error("too many requests"), { status: 429 });
    expect(classifyAuthError(err).countsAgainstUser).toBe(false);
  });

  it("the typed CLIENT_SESSION_WRITE_FAILED branch is hit even when a plain Error carries the same string (no regression to the deleted NETWORK_PATTERNS entry)", () => {
    // Before the fix, NETWORK_PATTERNS included "sign-in didn't complete",
    // which would have classified this plain Error as NETWORK and used the
    // wrong copy. The bottom-of-file SESSION_INCOMPLETE branch must own it
    // instead and produce the member-safe recovery message.
    const out = classifyAuthError(new Error("Sign-in didn't complete."));
    expect(out.kind).not.toBe("NETWORK");
    expect(out.kind).toBe("SESSION_INCOMPLETE");
  });
});

describe("AUTH-CAPTCHA-LIFECYCLE-002: invalid_credentials is the ONLY punitive path", () => {
  it("an explicit credential rejection still counts (so lockout still works)", () => {
    const out = classifyAuthError(new Error("Invalid login credentials"));
    expect(out.kind).toBe("INVALID_CREDENTIALS");
    expect(out.countsAgainstUser).toBe(true);
  });

  it("a server-issued invalid_credentials code still counts", () => {
    const err = Object.assign(new Error("anything"), { code: "invalid_credentials" });
    expect(classifyAuthError(err).countsAgainstUser).toBe(true);
  });
});
