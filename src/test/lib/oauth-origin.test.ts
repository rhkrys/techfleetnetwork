import { describe, it, expect } from "vitest";
import { getCanonicalOAuthOrigin, isApexHost, needsCanonicalRestart } from "@/lib/auth/oauth-origin";

describe("oauth-origin canonicalization", () => {
  it("apex techfleet.network redirects to www", () => {
    const loc = { host: "techfleet.network", origin: "https://techfleet.network" };
    expect(isApexHost(loc.host)).toBe(true);
    expect(getCanonicalOAuthOrigin(loc)).toBe("https://www.techfleet.network");
    expect(needsCanonicalRestart(loc)).toBe(true);
  });

  it("www.techfleet.network passes through", () => {
    const loc = { host: "www.techfleet.network", origin: "https://www.techfleet.network" };
    expect(getCanonicalOAuthOrigin(loc)).toBe("https://www.techfleet.network");
    expect(needsCanonicalRestart(loc)).toBe(false);
  });

  it("lovable preview hosts pass through", () => {
    const loc = { host: "techfleetnetwork.lovable.app", origin: "https://techfleetnetwork.lovable.app" };
    expect(getCanonicalOAuthOrigin(loc)).toBe("https://techfleetnetwork.lovable.app");
    expect(needsCanonicalRestart(loc)).toBe(false);
  });

  it("localhost passes through", () => {
    const loc = { host: "localhost:8080", origin: "http://localhost:8080" };
    expect(getCanonicalOAuthOrigin(loc)).toBe("http://localhost:8080");
    expect(needsCanonicalRestart(loc)).toBe(false);
  });

  it("case-insensitive apex match", () => {
    expect(isApexHost("TechFleet.Network")).toBe(true);
  });
});
