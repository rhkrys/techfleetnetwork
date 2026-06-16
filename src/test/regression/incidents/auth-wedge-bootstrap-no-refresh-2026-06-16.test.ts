/**
 * AUTH-WEDGE-013..015 regression: Google login bouncing users to logged-out
 * home page during transient GoTrue bad_jwt hiccups (2026-06-16 incident).
 *
 * Root cause: AuthContext bootstrap fired refreshSession() on the first
 * transient bad_jwt, and the refresh inherited the same flapping backend
 * → classified as unrecoverable → purge in one round-trip, bypassing the
 * two-strike protection.
 *
 * Permanent fix: on first strike with structurally-valid, unexpired stored
 * token, trust the session and let the SDK background auto-refresh + the
 * 15s two-strike gate recover. No synchronous refresh from bootstrap.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AUTH_CONTEXT_SRC = readFileSync(
  join(process.cwd(), "src/contexts/AuthContext.tsx"),
  "utf8",
);

describe("AUTH-WEDGE-013..015 — bootstrap must not refreshSession on first transient bad_jwt", () => {
  it("AUTH-WEDGE-013 — bootstrap self-heal block does NOT call refreshSession()", () => {
    // Extract the bootstrap getUser/self-heal block. The whole AuthContext
    // file may legitimately reference refreshSession in unrelated paths in
    // the future, so we scope the assertion to the region between the
    // bootstrap getUser() call and the next setSession(resolvedSession).
    const start = AUTH_CONTEXT_SRC.indexOf("await supabase.auth.getUser()");
    const end = AUTH_CONTEXT_SRC.indexOf("setSession(resolvedSession)", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = AUTH_CONTEXT_SRC.slice(start, end);
    expect(block).not.toMatch(/refreshSession\s*\(/);
  });

  it("AUTH-WEDGE-014 — bootstrap self-heal beacons transient_bad_jwt on first strike", () => {
    const start = AUTH_CONTEXT_SRC.indexOf("await supabase.auth.getUser()");
    const end = AUTH_CONTEXT_SRC.indexOf("setSession(resolvedSession)", start);
    const block = AUTH_CONTEXT_SRC.slice(start, end);
    expect(block).toMatch(/beaconWedge\(\s*["']transient_bad_jwt["']\s*,\s*["']bootstrap["']\s*\)/);
  });

  it("AUTH-WEDGE-015 — second-strike / shape_invalid path still purges", () => {
    const start = AUTH_CONTEXT_SRC.indexOf("await supabase.auth.getUser()");
    const end = AUTH_CONTEXT_SRC.indexOf("setSession(resolvedSession)", start);
    const block = AUTH_CONTEXT_SRC.slice(start, end);
    expect(block).toMatch(/decision\.shouldPurge/);
    expect(block).toMatch(/purgeLocalAuthState\(\s*\{\s*reason:\s*["']jwt_corrupt["']/);
  });
});
