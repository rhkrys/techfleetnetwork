import { describe, it, expect, beforeEach } from "vitest";
import { readOAuthErrorFragment, clearOAuthErrorFragment } from "@/lib/auth/oauth-error-fragment";

describe("oauth-error-fragment", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("parses the real broker error string", () => {
    const result = readOAuthErrorFragment(
      "#error=server_error&error_description=failed+to+sign+in+with+vendor&state=84c9cd2ded56aa59db78ef16ed8fe9c0",
    );
    expect(result).toEqual({
      error: "server_error",
      description: "failed to sign in with vendor",
      state: "84c9cd2ded56aa59db78ef16ed8fe9c0",
    });
  });

  it("returns null for access_token fragment (does NOT interfere with implicit flow)", () => {
    expect(readOAuthErrorFragment("#access_token=eyJabc&refresh_token=xyz&token_type=bearer")).toBeNull();
  });

  it("returns null for recovery fragment", () => {
    expect(readOAuthErrorFragment("#type=recovery&access_token=eyJabc")).toBeNull();
  });

  it("returns null on empty hash", () => {
    expect(readOAuthErrorFragment("")).toBeNull();
    expect(readOAuthErrorFragment("#")).toBeNull();
  });

  it("clearOAuthErrorFragment strips the hash via history.replaceState", () => {
    window.history.replaceState(null, "", "/?foo=bar#error=server_error&error_description=fail");
    expect(window.location.hash).toBe("#error=server_error&error_description=fail");
    clearOAuthErrorFragment();
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?foo=bar");
  });
});
