/**
 * Regression — Gmail login bounced back to logged-out home page.
 *
 * Root cause: after Google bounce, the URL briefly carried the OAuth callback
 * (`?code=` or `#access_token=…`) before AuthContext consumed it. ProtectedRoute
 * saw `user === null` during that window and redirected to /login, surfaced as
 * "login hangs and sends me back home".
 *
 * Permanent fix: `src/lib/auth/oauth-callback-pending.ts` is the single source
 * of truth for "we are mid-OAuth-callback; defer redirects." ProtectedRoute
 * and AuthRedirectHandler both consult it. GoogleSignInButton arms it on click
 * and AuthContext clears it on SIGNED_IN (or after a 12s watchdog).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOAuthCallbackPending,
  isOAuthCallbackPending,
  isOAuthCallbackUrl,
  markOAuthCallbackPending,
} from "@/lib/auth/oauth-callback-pending";

function setHref(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, href: url.href, pathname: url.pathname, search: url.search, hash: url.hash, origin: url.origin },
  });
}

beforeEach(() => {
  sessionStorage.clear();
  setHref("https://app.test/dashboard");
});
afterEach(() => {
  clearOAuthCallbackPending();
});

describe("OAuth callback pending guard", () => {
  it("returns true while the URL still carries a PKCE code+state", () => {
    setHref("https://app.test/?code=abc&state=xyz");
    expect(isOAuthCallbackUrl()).toBe(true);
    expect(isOAuthCallbackPending()).toBe(true);
  });

  it("returns true while implicit hash tokens are present", () => {
    setHref("https://app.test/#access_token=aaa&refresh_token=bbb");
    expect(isOAuthCallbackPending()).toBe(true);
  });

  it("respects the in-flight flag set by the sign-in button", () => {
    markOAuthCallbackPending();
    expect(isOAuthCallbackPending()).toBe(true);
  });

  it("clears after consumer finishes", () => {
    markOAuthCallbackPending();
    clearOAuthCallbackPending();
    expect(isOAuthCallbackPending()).toBe(false);
  });

  it("watchdog trips after 12s so the app cannot freeze", () => {
    markOAuthCallbackPending();
    const future = Date.now() + 12_001;
    expect(isOAuthCallbackPending(future)).toBe(false);
    expect(sessionStorage.getItem("tfn_oauth_callback_pending_ms")).toBeNull();
  });

  it("returns false when neither URL nor flag indicates a callback", () => {
    expect(isOAuthCallbackPending()).toBe(false);
  });
});
