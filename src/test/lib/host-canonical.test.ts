import { describe, it, expect } from "vitest";
import { decideCanonicalRedirect } from "@/lib/host-canonical";

describe("decideCanonicalRedirect", () => {
  it("apex → www, preserving path/query/hash", () => {
    const d = decideCanonicalRedirect({
      host: "techfleet.network",
      pathname: "/login",
      search: "?next=/dashboard",
      hash: "#access_token=abc",
    });
    expect(d.shouldRedirect).toBe(true);
    expect(d.target).toBe("https://www.techfleet.network/login?next=/dashboard#access_token=abc");
  });

  it("www → no-op", () => {
    const d = decideCanonicalRedirect({
      host: "www.techfleet.network",
      pathname: "/login",
      search: "",
      hash: "",
    });
    expect(d.shouldRedirect).toBe(false);
  });

  it("localhost → no-op", () => {
    const d = decideCanonicalRedirect({ host: "localhost:8080", pathname: "/", search: "", hash: "" });
    expect(d.shouldRedirect).toBe(false);
  });

  it("lovable.app preview → no-op", () => {
    const d = decideCanonicalRedirect({
      host: "id-preview--abc.lovable.app",
      pathname: "/login",
      search: "",
      hash: "",
    });
    expect(d.shouldRedirect).toBe(false);
  });

  it("apex /~oauth callback → no-op (broker handles it)", () => {
    const d = decideCanonicalRedirect({
      host: "techfleet.network",
      pathname: "/~oauth/callback",
      search: "?code=xyz",
      hash: "",
    });
    expect(d.shouldRedirect).toBe(false);
  });

  it("case-insensitive host match", () => {
    const d = decideCanonicalRedirect({
      host: "TechFleet.Network",
      pathname: "/",
      search: "",
      hash: "",
    });
    expect(d.shouldRedirect).toBe(true);
  });
});
