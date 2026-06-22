import { describe, it, expect } from "vitest";
import { getCanonicalOAuthOrigin, isApexHost } from "@/lib/auth/oauth-origin";

describe("oauth-origin pinning (defense-in-depth; edge owns the 301)", () => {
  it("apex techfleet.network pins to www canonical origin", () => {
    const loc = { host: "techfleet.network", origin: "https://techfleet.network" };
    expect(isApexHost(loc.host)).toBe(true);
    expect(getCanonicalOAuthOrigin(loc)).toBe("https://www.techfleet.network");
  });

  it("www.techfleet.network passes through", () => {
    const loc = { host: "www.techfleet.network", origin: "https://www.techfleet.network" };
    expect(getCanonicalOAuthOrigin(loc)).toBe("https://www.techfleet.network");
  });

  it("lovable preview hosts pass through", () => {
    const loc = { host: "techfleetnetwork.lovable.app", origin: "https://techfleetnetwork.lovable.app" };
    expect(getCanonicalOAuthOrigin(loc)).toBe("https://techfleetnetwork.lovable.app");
  });

  it("localhost passes through", () => {
    const loc = { host: "localhost:8080", origin: "http://localhost:8080" };
    expect(getCanonicalOAuthOrigin(loc)).toBe("http://localhost:8080");
  });

  it("case-insensitive apex match", () => {
    expect(isApexHost("TechFleet.Network")).toBe(true);
  });
});
